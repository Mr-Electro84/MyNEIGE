#include "platform.hpp"

namespace neige {
static std::string configLine() {
    std::string value;
    require(bool(std::getline(std::cin, value)), "Relay configuration pipe closed");
    require(value.size() <= 2048 && value.find('\r') == std::string::npos, "Invalid relay configuration");
    return value;
}
static bool forbiddenDestination(uint32_t ip, const Adapter &vpn) {
    if ((ip >> 24) == 0 || (ip >> 24) == 127 || (ip >> 16) == 0xa9fe || (ip >> 28) >= 14 || ip == vpn.address)
        return true;
    for (const auto &adapter : adapters())
        if (adapter.address == ip)
            return true;
    return false;
}
static std::string readHeader(SOCKET client) {
    std::string result;
    auto deadline = GetTickCount64() + 5000;
    while (result.size() < 16384) {
        require(GetTickCount64() < deadline, "Proxy header timeout");
        char c = 0;
        int count = recv(client, &c, 1, 0);
        require(count == 1, "Incomplete proxy header");
        result += c;
        if (result.size() >= 4 && result.compare(result.size() - 4, 4, "\r\n\r\n") == 0)
            return result;
    }
    throw std::runtime_error("Proxy header limit exceeded");
}
static void tunnel(SOCKET client, SOCKET remote) {
    std::array<char, 16384> buffer{};
    uint64_t up = 0, down = 0;
    auto lastActivity = GetTickCount64();
    bool clientRead = true, remoteRead = true;
    while (clientRead || remoteRead) {
        fd_set reads;
        FD_ZERO(&reads);
        if (clientRead)
            FD_SET(client, &reads);
        if (remoteRead)
            FD_SET(remote, &reads);
        timeval timeout{0, 200000};
        int count = select(0, &reads, nullptr, nullptr, &timeout);
        require(count >= 0, "Tunnel select failed");
        require(GetTickCount64() - lastActivity < 20000, "Tunnel idle timeout");
        for (int side = 0; side < 2; ++side) {
            SOCKET source = side == 0 ? client : remote, destination = side == 0 ? remote : client;
            if (!FD_ISSET(source, &reads))
                continue;
            int got = recv(source, buffer.data(), static_cast<int>(buffer.size()), 0);
            if (got <= 0) {
                if (side == 0)
                    clientRead = false;
                else
                    remoteRead = false;
                shutdown(destination, SD_SEND);
                continue;
            }
            sendAll(destination, buffer.data(), static_cast<size_t>(got));
            if (side == 0)
                up += got;
            else
                down += got;
            lastActivity = GetTickCount64();
        }
    }
    std::cout << "FLOW " << up << " " << down << std::endl;
}
int relayWorker() {
    require(GetFileType(GetStdHandle(STD_INPUT_HANDLE)) == FILE_TYPE_PIPE,
            "Relay requires its inherited anonymous configuration pipe");
    require(configLine() == "MYNEIGE_RELAY_V1", "Unknown relay configuration");
    Adapter vpn;
    vpn.address = ipv4(configLine());
    vpn.index = static_cast<uint32_t>(std::stoul(configLine()));
    vpn.luid = std::stoull(configLine());
    std::vector<uint32_t> dns;
    for (auto &server : split(configLine(), ','))
        dns.push_back(ipv4(server));
    std::string host = lower(configLine()), token = configLine();
    require(validHost(host) && token.size() == 64, "Invalid relay session");
    for (char c : token)
        require(isxdigit(static_cast<unsigned char>(c)) != 0, "Invalid session token");
    std::string expected = "Basic " + basic64("myneige:" + token);
    wipe(token);
    auto current = adapterFor(vpn.address);
    require(current.luid == vpn.luid && current.index == vpn.index, "VPN interface changed before relay start");
    auto addresses = resolveVpn(vpn, dns, host);
    for (auto ip : addresses)
        require(!forbiddenDestination(ip, vpn), "Target resolved to a forbidden local address");
    uint16_t port = 0;
    auto listener = loopbackListener(port);
    std::cout << "READY " << port << " ";
    for (size_t i = 0; i < addresses.size(); ++i)
        std::cout << (i ? "," : "") << ipText(addresses[i]);
    std::cout << std::endl;
    // One request at a time deliberately bounds resources in this network-only pilot.
    for (;;) {
        Socket client(accept(listener.s, nullptr, nullptr));
        require(client.s != INVALID_SOCKET, "Proxy accept failed");
        socketTimeout(client.s, 3000);
        bool established = false;
        try {
            auto request = parseConnect(readHeader(client.s));
            if (!constantEqual(request.authorization, expected)) {
                wipe(request.authorization);
                sendText(client.s, "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic "
                                   "realm=\"MyNEIGE-PoC\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                continue;
            }
            wipe(request.authorization);
            if (request.host != host) {
                sendText(client.s, "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                continue;
            }
            // No resolver cache: every new CONNECT is resolved through the VPN.
            auto resolved = resolveVpn(vpn, dns, host);
            Socket remote;
            for (auto address : resolved) {
                require(!forbiddenDestination(address, vpn), "Forbidden target address");
                try {
                    auto candidate = vpnSocket(vpn, SOCK_STREAM, IPPROTO_TCP);
                    connectWithin(candidate.s, endpoint(address, 443));
                    remote = std::move(candidate);
                    break;
                } catch (const std::exception &) { /* Next A record, still bound to the same tunnel. */
                }
            }
            require(remote.s != INVALID_SOCKET, "Target unreachable through VPN");
            sendText(client.s, "HTTP/1.1 200 Connection Established\r\n\r\n");
            established = true;
            tunnel(client.s, remote.s);
        } catch (const std::exception &) {
            if (!established) {
                try {
                    sendText(client.s, "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                } catch (...) {
                }
            }
            std::cout << "REQUEST_FAILED" << std::endl;
        }
    }
}
int blockedProbe(uint16_t port, bool ipv6, bool bound) {
    Socket socket = bound ? vpnSocket(adapterFor(0x7f000001), SOCK_STREAM, IPPROTO_TCP)
                          : Socket(::socket(ipv6 ? AF_INET6 : AF_INET, SOCK_STREAM, IPPROTO_TCP));
    require(socket.s != INVALID_SOCKET, "Cannot create quarantine probe");
    try {
        if (ipv6) {
            sockaddr_in6 address{};
            address.sin6_family = AF_INET6;
            address.sin6_addr = in6addr_loopback;
            address.sin6_port = htons(port);
            connectWithinAddress(socket.s, reinterpret_cast<sockaddr *>(&address), sizeof(address), 2000);
        } else
            connectWithin(socket.s, endpoint(0x7f000001, port), 2000);
        std::cout << "UNEXPECTED_CONNECT" << std::endl;
        return 4;
    } catch (const std::exception &) {
        int code = WSAGetLastError();
        std::cout << "BLOCK_RESULT " << code << std::endl;
        return code == WSAEACCES ? 0 : 5;
    }
}
} // namespace neige
