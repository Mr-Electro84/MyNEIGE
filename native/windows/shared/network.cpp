#include "network-platform.hpp"
namespace neige {
std::vector<Adapter> adapters() {
    ULONG length = 16384;
    Bytes storage(length);
    ULONG code = GetAdaptersAddresses(AF_INET, GAA_FLAG_INCLUDE_PREFIX, nullptr,
                                      reinterpret_cast<IP_ADAPTER_ADDRESSES *>(storage.data()), &length);
    if (code == ERROR_BUFFER_OVERFLOW) {
        storage.resize(length);
        code = GetAdaptersAddresses(AF_INET, GAA_FLAG_INCLUDE_PREFIX, nullptr,
                                    reinterpret_cast<IP_ADAPTER_ADDRESSES *>(storage.data()), &length);
    }
    wincheck(code, "GetAdaptersAddresses");
    std::vector<Adapter> result;
    for (auto p = reinterpret_cast<IP_ADAPTER_ADDRESSES *>(storage.data()); p; p = p->Next) {
        if (p->OperStatus != IfOperStatusUp)
            continue;
        for (auto address = p->FirstUnicastAddress; address; address = address->Next) {
            if (address->Address.lpSockaddr->sa_family != AF_INET)
                continue;
            Adapter item;
            item.index = p->IfIndex;
            item.luid = p->Luid.Value;
            item.address = ntohl(reinterpret_cast<sockaddr_in *>(address->Address.lpSockaddr)->sin_addr.S_un.S_addr);
            item.preferred = address->DadState == IpDadStatePreferred;
            item.name = utf8(p->FriendlyName);
            item.guid = p->AdapterName;
            for (auto dns = p->FirstDnsServerAddress; dns; dns = dns->Next)
                if (dns->Address.lpSockaddr->sa_family == AF_INET)
                    item.dns.push_back(
                        ntohl(reinterpret_cast<sockaddr_in *>(dns->Address.lpSockaddr)->sin_addr.S_un.S_addr));
            result.push_back(std::move(item));
        }
    }
    return result;
}
Adapter adapterFor(uint32_t address) {
    std::vector<Adapter> matches;
    for (auto &adapter : adapters())
        if (adapter.address == address)
            matches.push_back(adapter);
    require(matches.size() == 1, "VPN address does not identify exactly one active interface");
    require(matches[0].preferred, "VPN address is not yet preferred (DAD pending or failed)");
    MIB_IPINTERFACE_ROW row{};
    InitializeIpInterfaceEntry(&row);
    row.Family = AF_INET;
    row.InterfaceLuid.Value = matches[0].luid;
    wincheck(GetIpInterfaceEntry(&row), "GetIpInterfaceEntry");
    require(!row.WeakHostSend && !row.WeakHostReceive, "Weak-host VPN interface is not supported by this pilot");
    return matches[0];
}
Socket boundNetworkSocket(const Adapter &adapter, int type, int protocol) {
    auto current = adapterFor(adapter.address);
    require(current.index == adapter.index && current.luid == adapter.luid, "Tunnel interface generation changed");
    require(current.name == adapter.name && current.guid == adapter.guid, "Tunnel adapter name or GUID changed");
    Socket result(socket(AF_INET, type, protocol));
    require(result.s != INVALID_SOCKET, "Cannot create tunnel socket");
    DWORD index = htonl(adapter.index);
    const int selected =
        setsockopt(result.s, IPPROTO_IP, IP_UNICAST_IF, reinterpret_cast<const char *>(&index), sizeof(index));
    if (selected != 0)
        throw std::runtime_error("IP_UNICAST_IF failed (Winsock " + std::to_string(WSAGetLastError()) + ")");
    auto source = endpoint(adapter.address, 0);
    if (bind(result.s, reinterpret_cast<sockaddr *>(&source), sizeof(source)) != 0)
        throw std::runtime_error("Cannot bind VPN source (Winsock " + std::to_string(WSAGetLastError()) + ")");
    socketTimeout(result.s, 5000);
    return result;
}
Socket vpnSocket(const Adapter &adapter, int type, int protocol) {
    return boundNetworkSocket(adapter, type, protocol);
}
std::vector<uint32_t> resolveVpn(const Adapter &adapter, const std::vector<uint32_t> &servers,
                                 const std::string &host, bool publicNetwork) {
    require(!servers.empty() && servers.size() <= 4, "A reliable VPN DNS server is required");
    for (auto server : servers) {
        const char *stage = "BIND";
        unsigned responseCode = 0;
        try {
            auto random = randomHex(2);
            uint16_t id = static_cast<uint16_t>(std::stoul(random, nullptr, 16));
            auto query = dnsQuery(host, id);
            auto socket = vpnSocket(adapter, SOCK_DGRAM, IPPROTO_UDP);
            auto destination = endpoint(server, 53);
            stage = "UDP_CONNECT";
            require(connect(socket.s, reinterpret_cast<sockaddr *>(&destination), sizeof(destination)) == 0,
                    "DNS UDP connect failed");
            stage = "UDP_SEND";
            reportFlow(publicNetwork ? "DNS_PUBLIC" : "DNS", "UDP", socket.s, server, 53);
            sendAll(socket.s, query.data(), query.size());
            Bytes packet(65535);
            stage = "UDP_RECEIVE";
            int count = recv(socket.s, reinterpret_cast<char *>(packet.data()), static_cast<int>(packet.size()), 0);
            require(count > 0, "VPN DNS did not answer");
            packet.resize(count);
            bool truncated = false;
            stage = "UDP_PARSE";
            responseCode = packet.size() >= 4 ? packet[3] & 15 : 0;
            auto result = dnsParse(packet, id, host, truncated);
            if (!truncated)
                return result;
            stage = "TCP_BIND_CONNECT";
            auto tcp = vpnSocket(adapter, SOCK_STREAM, IPPROTO_TCP);
            connectWithin(tcp.s, destination, 5000);
            reportFlow(publicNetwork ? "DNS_PUBLIC" : "DNS", "TCP", tcp.s, server, 53);
            unsigned char size[2]{static_cast<unsigned char>(query.size() >> 8),
                                  static_cast<unsigned char>(query.size() & 255)};
            stage = "TCP_SEND";
            sendAll(tcp.s, size, 2);
            sendAll(tcp.s, query.data(), query.size());
            stage = "TCP_RECEIVE";
            recvAll(tcp.s, size, 2);
            size_t length = (size[0] << 8) | size[1];
            require(length >= 12, "Short DNS TCP packet");
            packet.resize(length);
            recvAll(tcp.s, packet.data(), packet.size());
            stage = "TCP_PARSE";
            responseCode = packet.size() >= 4 ? packet[3] & 15 : 0;
            result = dnsParse(packet, id, host, truncated);
            require(!truncated, "Truncated DNS TCP answer");
            return result;
        } catch (const std::exception &error) {
            // Generated metadata only; no DNS names, records, management lines or secrets.
            const int code = WSAGetLastError();
            const bool parsing = std::string(stage) == "UDP_PARSE" || std::string(stage) == "TCP_PARSE";
            const char *reason = !parsing ? "TRANSPORT" : responseCode ? "RCODE" :
                std::string(error.what()) == "No usable IPv4 DNS answer" ? "NO_IPV4" : "INVALID_RESPONSE";
            std::osyncstream(std::cout) << "DNS_ATTEMPT_FAILED host=" << host << " stage=" << stage
                << " wsa=" << (parsing ? 0 : code) << " rcode=" << responseCode << " reason=" << reason << std::endl;
            // These failures contain only constants and numeric OS error codes from our own code.
            // This scope never consumes management messages or remote text.
            if (std::string(stage) == "BIND")
                std::cout << "DNS_BIND_FAILURE " << error.what() << std::endl;
            // Try only explicitly supplied tunnel DNS, never the system resolver.
        }
    }
    throw std::runtime_error("All VPN DNS servers failed; no system-DNS fallback was attempted");
}
void reportFlow(const char *role, const char *protocol, SOCKET socket, uint32_t destination, uint16_t port) {
    sockaddr_in local{};
    int length = sizeof(local);
    require(getsockname(socket, reinterpret_cast<sockaddr *>(&local), &length) == 0, "Cannot inspect flow source");
    const bool publicFlow = std::string(role) == "DNS_PUBLIC" || std::string(role) == "WEB_PUBLIC";
    std::osyncstream(std::cout) << (publicFlow ? "PUBLIC_FLOW role=" : "VPN_FLOW role=") << role << " protocol=" << protocol
                                << " source=" << ipText(ntohl(local.sin_addr.S_un.S_addr)) << ":"
                                << ntohs(local.sin_port) << " destination=" << ipText(destination) << ":" << port
                                << std::endl;
}
std::vector<uint32_t> resolveVpnTcp(const Adapter &adapter, const std::vector<uint32_t> &servers,
                                    const std::string &host) {
    require(!servers.empty() && servers.size() <= 4, "Verified VPN DNS servers required for TCP test");
    for (auto server : servers) {
        try {
            auto query = dnsQuery(host, static_cast<uint16_t>(std::stoul(randomHex(2), nullptr, 16)));
            uint16_t id = static_cast<uint16_t>((query[0] << 8) | query[1]);
            auto socket = vpnSocket(adapter, SOCK_STREAM, IPPROTO_TCP);
            connectWithin(socket.s, endpoint(server, 53), 5000);
            reportFlow("DNS", "TCP", socket.s, server, 53);
            unsigned char length[2]{static_cast<unsigned char>(query.size() >> 8),
                                    static_cast<unsigned char>(query.size() & 255)};
            sendAll(socket.s, length, 2);
            sendAll(socket.s, query.data(), query.size());
            recvAll(socket.s, length, 2);
            const size_t size = (length[0] << 8) | length[1];
            require(size >= 12, "DNS TCP response too short");
            Bytes response(size);
            recvAll(socket.s, response.data(), response.size());
            bool truncated = false;
            auto result = dnsParse(response, id, host, truncated);
            require(!truncated, "DNS TCP response truncated");
            return result;
        } catch (const std::exception &) {
        }
    }
    throw std::runtime_error("VPN DNS TCP test failed; no fallback outside tunnel");
}
} // namespace neige
