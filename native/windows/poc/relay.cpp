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
    std::osyncstream(std::cout) << "FLOW " << up << " " << down << std::endl;
}
int relayWorker(bool publicMode) {
    requirePrivilegedParent();
    require(!isAdministrator(), "Relay must run without administrator rights");
    require(GetFileType(GetStdHandle(STD_INPUT_HANDLE)) == FILE_TYPE_PIPE,
            "Relay requires its inherited anonymous configuration pipe");
    require(configLine() == (publicMode ? "MYNEIGE_PUBLIC_V1" : "MYNEIGE_RELAY_V4"), "Unknown relay configuration");
    Adapter vpn;
    vpn.address = ipv4(configLine());
    vpn.index = static_cast<uint32_t>(std::stoul(configLine()));
    vpn.luid = std::stoull(configLine());
    vpn.guid = configLine();
    vpn.name = configLine();
    std::vector<uint32_t> dns;
    for (auto &server : split(configLine(), ','))
        dns.push_back(ipv4(server));
    std::string host = lower(configLine()), token = configLine();
    const auto scope = configLine();
    const auto publicPortValue = std::stoul(configLine());
    require(publicPortValue <= 65535, "Invalid public relay port");
    const auto publicPort = static_cast<uint16_t>(publicPortValue);
    require(publicMode ? scope == "public" && publicPort == 0 && publicServiceHost(host) :
                (scope == "appigs" && publicPort == 0) || (scope == "university" && publicPort != 0),
            "Invalid relay destination scope");
    require(validHost(host) && token.size() == 64, "Invalid relay session");
    for (char c : token)
        require(isxdigit(static_cast<unsigned char>(c)) != 0, "Invalid session token");
    std::string expected = "Basic " + basic64("myneige:" + token);
    wipe(token);
    auto current = adapterFor(vpn.address);
    require(current.luid == vpn.luid && current.index == vpn.index && current.guid == vpn.guid &&
                current.name == vpn.name,
            "VPN interface changed before relay start");
    std::vector<uint32_t> addresses;
    if (!publicMode) {
        addresses = resolveVpn(vpn, dns, host);
        auto tcpAddresses = resolveVpnTcp(vpn, dns, host);
        require(!tcpAddresses.empty(), "No usable DNS TCP response");
        std::cout << "DNS_UDP_TCP_VALIDATED" << std::endl;
    }
    for (auto ip : addresses)
        require(!forbiddenDestination(ip, vpn), "Target resolved to a forbidden local address");
    uint16_t port = 0;
    auto listener = loopbackListener(port);
    std::cout << (publicMode ? "PUBLIC_READY " : "READY ") << port;
    if (!publicMode) std::cout << " ";
    for (size_t i = 0; i < addresses.size(); ++i)
        std::cout << (i ? "," : "") << ipText(addresses[i]);
    std::cout << std::endl;
    // Browser resources require concurrent CONNECTs; concurrency remains explicitly bounded.
    static std::atomic<unsigned> active{0};
    static RelaySlots slots;
    for (;;) {
        Socket client(accept(listener.s, nullptr, nullptr));
        require(client.s != INVALID_SOCKET, "Proxy accept failed");
        socketTimeout(client.s, 3000);
        const unsigned entryLimit = publicMode ? RelaySlots::limit : 80;
        if (active.fetch_add(1) >= entryLimit) {
            --active;
            std::osyncstream(std::cout) << "RELAY_CAPACITY limit=" << entryLimit << std::endl;
            try {
                sendText(client.s,
                         "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            } catch (...) {
            }
            continue;
        }
        std::thread([client = std::move(client), vpn, dns, host, expected, scope, publicMode, publicPort]() mutable {
            struct Count {
                bool reserved = false, publicRoute = false;
                ~Count() {
                    if (reserved) slots.release(publicRoute);
                    --active;
                }
            } count;
            bool established = false;
            std::string requestHost = "unknown";
            const char *stage = "HEADER";
            try {
                auto request = parseConnect(readHeader(client.s));
                requestHost = request.host;
                stage = "AUTH";
                if (!constantEqual(request.authorization, expected)) {
                    wipe(request.authorization);
                    sendText(client.s, "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic "
                                       "realm=\"MyNEIGE-PoC\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    return;
                }
                wipe(request.authorization);
                stage = "POLICY";
                if (publicMode ? !publicServiceHost(request.host) :
                    request.host != host && !(scope == "university" && browserHost(request.host))) {
                    sendText(client.s, "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    return;
                }
                count.publicRoute = scope == "university" && publicServiceHost(request.host);
                if (!publicMode) {
                    count.reserved = slots.acquire(count.publicRoute);
                    if (!count.reserved) {
                        std::osyncstream(std::cout) << "RELAY_CAPACITY limit=32" << std::endl;
                        sendText(client.s, "HTTP/1.1 503 Service Unavailable\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                        return;
                    }
                }
                if (!publicMode && scope == "university" && publicServiceHost(request.host)) {
                    // Le relais VPN ne résout jamais ces noms. Le second relais
                    // revérifie la liste publique avant toute résolution locale.
                    stage = "CONNECT";
                    Socket upstream(socket(AF_INET, SOCK_STREAM, IPPROTO_TCP));
                    require(upstream.s != INVALID_SOCKET, "Cannot create public proxy connection");
                    connectWithin(upstream.s, endpoint(0x7f000001, publicPort), 3000);
                    auto header = publicConnectHeader(request.host, expected);
                    sendText(upstream.s, header); wipe(header);
                    established = true; stage = "TUNNEL";
                    // La réponse CONNECT du second relais est transmise telle
                    // quelle ; TLS, cookies et corps POST restent de bout en bout.
                    tunnel(client.s, upstream.s);
                    return;
                }
                // No resolver cache: every new CONNECT is resolved through the VPN.
                stage = "DNS";
                auto resolved = resolveVpn(vpn, dns, request.host, publicMode);
                Socket remote;
                for (auto address : resolved) {
                    stage = "ADDRESS";
                    require(!forbiddenDestination(address, vpn), "Forbidden target address");
                    require(!publicMode || publicDestination(address), "Non-public destination refused by public relay");
                    try {
                        stage = "CONNECT";
                        auto candidate = vpnSocket(vpn, SOCK_STREAM, IPPROTO_TCP);
                        connectWithin(candidate.s, endpoint(address, 443));
                        reportFlow(publicMode ? "WEB_PUBLIC" : "WEB", "TCP", candidate.s, address, 443);
                        remote = std::move(candidate);
                        break;
                    } catch (const std::exception &) { /* Next A record, still bound to the same tunnel. */
                    }
                }
                require(remote.s != INVALID_SOCKET, "Target unreachable through VPN");
                sendText(client.s, "HTTP/1.1 200 Connection Established\r\n\r\n");
                established = true;
                stage = "TUNNEL";
                tunnel(client.s, remote.s);
            } catch (const std::exception &) {
                const int code = WSAGetLastError();
                if (!established) {
                    try {
                        sendText(client.s,
                                 "HTTP/1.1 502 Bad Gateway\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                    } catch (...) {
                    }
                }
                std::osyncstream(std::cout) << "REQUEST_FAILED" << std::endl;
                // Aucun texte d'exception, en-tête HTTP, chemin ou secret.
                std::osyncstream(std::cout) << "RELAY_REQUEST_FAILED host=" << requestHost << " stage=" << stage
                    << " wsa=" << (std::string(stage) == "CONNECT" || std::string(stage) == "TUNNEL" ? code : 0) << std::endl;
            }
        }).detach();
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
