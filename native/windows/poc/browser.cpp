#include "browser.hpp"
namespace neige {
static void copyReadOnlyTree(const std::filesystem::path &source, const std::filesystem::path &destination) {
    const DWORD attributes = GetFileAttributesW(source.c_str());
    require(attributes != INVALID_FILE_ATTRIBUTES && !(attributes & FILE_ATTRIBUTE_REPARSE_POINT),
            "Browser sources must not contain reparse points");
    if (attributes & FILE_ATTRIBUTE_DIRECTORY) {
        require(std::filesystem::create_directory(destination), "Cannot create owned browser directory");
        grantUserRead(destination);
        for (const auto &entry : std::filesystem::directory_iterator(source))
            copyReadOnlyTree(entry.path(), destination / entry.path().filename());
    } else {
        require(CopyFileW(source.c_str(), destination.c_str(), TRUE) != 0, "Cannot copy browser resource");
        grantUserRead(destination);
    }
}
void BrowserPilot::prepare(const Staging &staging, const std::filesystem::path &projectRoot) {
    auto root = std::filesystem::absolute(projectRoot);
    auto runtime = root / L"node_modules/electron/dist";
    require(std::filesystem::is_regular_file(runtime / L"electron.exe"), "Install the pinned Electron runtime first");
    const auto browser = staging.directory / L"browser";
    require(std::filesystem::create_directory(browser), "Cannot create protected browser staging");
    grantUserRead(browser);
    copyReadOnlyTree(runtime, browser / L"runtime");
    copyReadOnlyTree(root / L"src", browser / L"app");
    executable = browser / L"runtime/electron.exe";
    entry = browser / L"app/main/index.js";
    userData = root / L".local/browser-data" / staging.directory.filename();
}
static Socket listener6(uint16_t &port) {
    Socket result(socket(AF_INET6, SOCK_STREAM, IPPROTO_TCP));
    require(result.s != INVALID_SOCKET, "IPv6 local controls unavailable");
    BOOL exclusive = TRUE;
    require(setsockopt(result.s, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, reinterpret_cast<char *>(&exclusive),
                       sizeof(exclusive)) == 0,
            "Cannot reserve IPv6 control socket");
    sockaddr_in6 address{};
    address.sin6_family = AF_INET6;
    address.sin6_addr = in6addr_loopback;
    require(bind(result.s, reinterpret_cast<sockaddr *>(&address), sizeof(address)) == 0 && listen(result.s, 8) == 0,
            "Cannot bind IPv6 control socket");
    int length = sizeof(address);
    require(getsockname(result.s, reinterpret_cast<sockaddr *>(&address), &length) == 0,
            "Cannot read IPv6 control port");
    port = ntohs(address.sin6_port);
    return result;
}
static Socket udpControl(uint16_t port, bool ipv6) {
    Socket server(socket(ipv6 ? AF_INET6 : AF_INET, SOCK_DGRAM, IPPROTO_UDP));
    Socket sender(socket(ipv6 ? AF_INET6 : AF_INET, SOCK_DGRAM, IPPROTO_UDP));
    require(server.s != INVALID_SOCKET && sender.s != INVALID_SOCKET, "UDP controls unavailable");
    BOOL exclusive = TRUE;
    require(setsockopt(server.s, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, reinterpret_cast<char *>(&exclusive),
                       sizeof(exclusive)) == 0,
            "Cannot reserve UDP control port");
    sockaddr_in address4 = endpoint(0x7f000001, port);
    sockaddr_in6 address6{};
    address6.sin6_family = AF_INET6;
    address6.sin6_addr = in6addr_loopback;
    address6.sin6_port = htons(port);
    auto address = ipv6 ? reinterpret_cast<sockaddr *>(&address6) : reinterpret_cast<sockaddr *>(&address4);
    int length = ipv6 ? sizeof(address6) : sizeof(address4);
    require(bind(server.s, address, length) == 0, "Cannot bind UDP receiver");
    require(sendto(sender.s, "POSITIVE", 8, 0, address, length) == 8 && readable(server.s, 2000),
            "UDP positive control did not arrive");
    char data[32]{};
    require(recv(server.s, data, sizeof(data), 0) == 8 && std::string(data, 8) == "POSITIVE",
            "Invalid UDP positive control");
    return server;
}
static DWORD pipeIo(HANDLE pipe, void *buffer, DWORD count, bool write) {
    Handle event(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    require(event.h != nullptr, "Cannot create browser IPC event");
    OVERLAPPED ov{};
    ov.hEvent = event.h;
    DWORD done = 0;
    BOOL ok = write ? WriteFile(pipe, buffer, count, &done, &ov) : ReadFile(pipe, buffer, count, &done, &ov);
    if (!ok) {
        require(GetLastError() == ERROR_IO_PENDING, "Browser control pipe closed");
        if (WaitForSingleObject(event.h, 5000) != WAIT_OBJECT_0) {
            CancelIoEx(pipe, &ov);
            GetOverlappedResult(pipe, &ov, &done, TRUE);
            throw std::runtime_error("Browser IPC timed out");
        }
        require(GetOverlappedResult(pipe, &ov, &done, FALSE) != 0, "Browser IPC transfer failed");
    }
    return done;
}
void BrowserPilot::send(const std::string &frame) {
    size_t offset = 0;
    while (offset < frame.size()) {
        DWORD done = pipeIo(channel.h, const_cast<char *>(frame.data()) + offset,
                            static_cast<DWORD>(frame.size() - offset), true);
        require(done > 0, "Browser IPC write failed");
        offset += done;
    }
}
std::string BrowserPilot::poll() {
    for (;;) {
        auto newline = pending.find('\n');
        if (newline != std::string::npos) {
            auto result = trim(pending.substr(0, newline));
            pending.erase(0, newline + 1);
            return result;
        }
        DWORD available = 0;
        require(PeekNamedPipe(channel.h, nullptr, 0, nullptr, &available, nullptr) != 0,
                "Browser control disconnected");
        if (!available)
            return {};
        char buffer[4096]{};
        DWORD got = pipeIo(channel.h, buffer, std::min<DWORD>(available, sizeof(buffer)), false);
        pending.append(buffer, got);
        SecureZeroMemory(buffer, sizeof(buffer));
        require(pending.size() <= 16384, "Browser IPC frame too large");
    }
}
std::string BrowserPilot::wait(DWORD milliseconds) {
    const auto until = GetTickCount64() + milliseconds;
    while (GetTickCount64() < until) {
        auto line = poll();
        if (line.empty()) {
            require(child.running(), "Browser exited before readiness");
            Sleep(20);
            continue;
        }
        if (line.rfind("BROWSER_STAGE ", 0) == 0)
            std::cout << line << std::endl;
        if (line.rfind("BROWSER_PROBE ", 0) == 0)
            std::cout << line << std::endl;
        if (line.rfind("BROWSER_DIAGNOSTIC ", 0) == 0 && line.size() < 150)
            std::cout << line << std::endl;
        if (line.rfind("UI_ERROR ", 0) == 0)
            std::cout << line << std::endl;
        if (line.rfind("UI_", 0) == 0)
            return line;
    }
    throw std::runtime_error("Browser protocol timed out");
}
void BrowserPilot::launch(Firewall &firewall, bool selfTest) {
    firewall.quarantineBrowser(executable.wstring());
    uint16_t port4 = 0, port6 = 0;
    auto control4 = loopbackListener(port4);
    auto control6 = listener6(port6);
    auto udp4 = udpControl(port4, false);
    auto udp6 = udpControl(port6, true);
    auto name = L"\\\\.\\pipe\\MyNEIGE-" + wide(randomHex(16));
    auto sddl = L"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GRGW;;;" + currentUserSid() + L")S:(ML;;NW;;;ME)";
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    require(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr) !=
                0,
            "Cannot create browser IPC ACL");
    std::unique_ptr<void, decltype(&LocalFree)> freeDescriptor(descriptor, LocalFree);
    SECURITY_ATTRIBUTES sa{sizeof(sa), descriptor, FALSE};
    channel = Handle(CreateNamedPipeW(
        name.c_str(), PIPE_ACCESS_DUPLEX | FILE_FLAG_FIRST_PIPE_INSTANCE | FILE_FLAG_OVERLAPPED,
        PIPE_TYPE_BYTE | PIPE_READMODE_BYTE | PIPE_WAIT | PIPE_REJECT_REMOTE_CLIENTS, 1, 16384, 16384, 0, &sa));
    require(channel.h != INVALID_HANDLE_VALUE, "Cannot reserve unique browser control pipe");
    Handle connected(CreateEventW(nullptr, TRUE, FALSE, nullptr));
    require(connected.h != nullptr, "Cannot create pipe connection event");
    OVERLAPPED connection{};
    connection.hEvent = connected.h;
    BOOL immediate = ConnectNamedPipe(channel.h, &connection);
    require(immediate || GetLastError() == ERROR_IO_PENDING, "Cannot listen for browser IPC");
    child =
        job.spawn(executable.wstring(),
                  {entry.wstring(), L"--user-data-dir=" + userData.wstring(), L"--myneige-pipe=" + name}, false, true);
    if (!immediate && WaitForSingleObject(connected.h, 30000) != WAIT_OBJECT_0) {
        CancelIoEx(channel.h, &connection);
        DWORD ignored = 0;
        GetOverlappedResult(channel.h, &connection, &ignored, TRUE);
        throw std::runtime_error("Browser did not connect its control pipe");
    }
    ULONG peer = 0;
    require(GetNamedPipeClientProcessId(channel.h, &peer) && peer == child.pid, "Browser IPC client PID mismatch");
    send("BOOT " + std::to_string(port4) + " " + std::to_string(port6) + " " + (selfTest ? "test" : "live") + "\n");
    auto result = wait(30000);
    require(result == "UI_NETWORK_BLOCKED", "Browser direct-network quarantine self-test failed");
    require(!readable(udp4.s, 500) && !readable(udp6.s, 500), "Browser UDP escaped quarantine");
    std::cout << "BROWSER_UDP_RECEIVERS_EMPTY ipv4=true ipv6=true positive_controls=true" << std::endl;
    // A permit is exercised while listeners are still live, then the UI waits for actual VPN readiness.
    firewall.allowBrowserProxy(executable.wstring(), port4);
    send("TEST_PROXY " + std::to_string(port4) + "\n");
    result = wait(30000);
    require(result == "UI_READY", "Browser proxy-only permit or sandbox self-test failed");
    firewall.revokeBrowserProxy(executable.wstring());
    std::cout << "BROWSER_PREFLIGHT ipv4_blocked=true ipv6_blocked=true udp_blocked=true child_blocked=true "
                 "sandbox=true proxy_only=true"
              << std::endl;
}
static std::string decodeCredential(const std::string &encoded) {
    require(!encoded.empty() && encoded.size() <= 8192 && encoded.size() % 2 == 0, "Invalid credential frame size");
    std::string value;
    value.reserve(encoded.size() / 2);
    auto digit = [](char c) -> unsigned {
        if (c >= '0' && c <= '9')
            return c - '0';
        if (c >= 'a' && c <= 'f')
            return c - 'a' + 10;
        throw std::runtime_error("Invalid credential encoding");
    };
    for (size_t i = 0; i < encoded.size(); i += 2) {
        unsigned c = digit(encoded[i]) * 16 + digit(encoded[i + 1]);
        require(c >= 32 && c != 127, "Credential contains a control character");
        value += static_cast<char>(c);
    }
    return value;
}
void BrowserPilot::proxyTest(Firewall &firewall) {
    uint16_t port = 0;
    auto listener = loopbackListener(port);
    auto token = randomHex(32);
    auto expected = "Basic " + basic64("myneige:" + token);
    firewall.allowBrowserProxy(executable.wstring(), port);
    auto frame = "TEST_NAV_PROXY " + std::to_string(port) + " " + token + "\n";
    send(frame);
    wipe(frame);
    wipe(token);
    bool authenticated = false, tlsStarted = false;
    const auto until = GetTickCount64() + 15000;
    while (GetTickCount64() < until && !tlsStarted) {
        auto line = poll();
        if (!line.empty()) {
            if (line.rfind("UI_NET_ERROR ", 0) == 0 && line.size() < 120)
                std::cout << "BROWSER_TEST_NETWORK " << line.substr(13) << std::endl;
            require(line.rfind("UI_ERROR ", 0) != 0, "Local browser proxy navigation failed");
        }
        if (!readable(listener.s, 100))
            continue;
        Socket client(accept(listener.s, nullptr, nullptr));
        require(client.s != INVALID_SOCKET, "Cannot accept browser test proxy");
        socketTimeout(client.s, 3000);
        auto request = parseConnect(readHeader(client.s));
        require(request.host == "www.appigs.univ-avignon.fr", "Unexpected local proxy test host");
        if (!constantEqual(request.authorization, expected)) {
            wipe(request.authorization);
            sendText(client.s, "HTTP/1.1 407 Proxy Authentication Required\r\nProxy-Authenticate: Basic "
                               "realm=\"MyNEIGE-PoC\"\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            continue;
        }
        wipe(request.authorization);
        authenticated = true;
        sendText(client.s, "HTTP/1.1 200 Connection Established\r\n\r\n");
        unsigned char prefix[3]{};
        auto received = recv(client.s, reinterpret_cast<char *>(prefix), sizeof(prefix), MSG_WAITALL);
        tlsStarted = received == 3 && prefix[0] == 22 && prefix[1] == 3;
    }
    wipe(expected);
    require(authenticated && tlsStarted, "Chromium did not authenticate and start TLS through the permitted proxy");
    // Chromium may retry a TLS handshake after the deliberate transport close.
    // Refuse retries rather than leaving them pending in an unserviced listener.
    listener.reset();
    std::cout << "BROWSER_TEST_TLS_AUTHENTICATED" << std::endl;
    auto result = wait(10000);
    while (result.rfind("UI_NET_ERROR ", 0) == 0 || result == "UI_PROXY_AUTH MATCHED")
        result = wait(10000);
    require(result == "UI_NAV_PROXY_DONE", "Chromium did not report the intentional test transport closure");
    firewall.revokeBrowserProxy(executable.wstring());
    std::cout << "BROWSER_CHROMIUM_PROXY authenticated=true tls_client_hello=true no_remote_network=true" << std::endl;
}
std::pair<std::string, std::string> BrowserPilot::credentials() {
    send("AUTH_REQUIRED\n");
    auto until = GetTickCount64() + 300000;
    while (GetTickCount64() < until) {
        auto line = poll();
        if (line.empty()) {
            require(child.running(), "Browser closed during authentication");
            Sleep(50);
            continue;
        }
        if (line == "UI_STOP")
            throw std::runtime_error("Cancelled in browser");
        if (line.rfind("UI_CREDENTIALS ", 0) != 0)
            continue;
        auto fields = split(line, ' ');
        wipe(line);
        require(fields.size() == 3, "Invalid browser authentication frame");
        try {
            auto result = std::make_pair(decodeCredential(fields[1]), decodeCredential(fields[2]));
            for (auto &field : fields)
                wipe(field);
            return result;
        } catch (...) {
            for (auto &field : fields)
                wipe(field);
            throw;
        }
    }
    throw std::runtime_error("Browser authentication timed out");
}
void BrowserPilot::ready(Firewall &firewall, uint16_t port, const std::string &token) {
    firewall.allowBrowserProxy(executable.wstring(), port);
    auto frame = "VPN_READY " + std::to_string(port) + " " + token + "\n";
    send(frame);
    wipe(frame);
}
void BrowserPilot::state(const std::string &value) {
    if (child.running())
        send("STATE " + value + "\n");
}
bool BrowserPilot::wantsStop() {
    if (!child.running()) {
        DWORD code = 1;
        GetExitCodeProcess(child.process.h, &code);
        require(code == 0, "Browser process failed; protected navigation stopped");
        return true;
    }
    for (unsigned n = 0; n < 32; ++n) {
        auto line = poll();
        if (line.empty())
            return false;
        if (line.rfind("UI_NET_ERROR ", 0) == 0 && line.size() < 120 &&
            line.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZ_0123456789 =-", 13) == std::string::npos)
            std::cout << "BROWSER_NETWORK " << line.substr(13) << std::endl;
        if (line == "UI_PROXY_AUTH MATCHED")
            std::cout << "BROWSER_PROXY_AUTH matched=true" << std::endl;
        if (line == "UI_CAS_PREFILL PREFILLED" || line == "UI_CAS_PREFILL SKIPPED" ||
            line == "UI_CAS_PREFILL UNSUPPORTED" || line == "UI_CAS_PREFILL UNAVAILABLE" ||
            line == "UI_CAS_PREFILL EXPIRED")
            std::cout << "BROWSER_CAS_PREFILL status=" << line.substr(15) << std::endl;
        require(line.rfind("UI_ERROR ", 0) != 0, "Browser reported a guarded navigation failure");
        if (line == "UI_STOP")
            return true;
        if (line.rfind("UI_PAGE ", 0) == 0) {
            auto fields = split(line, ' ');
            if (fields.size() == 3 && universityHost(fields[1]) &&
                fields[2].find_first_not_of("0123456789") == std::string::npos)
                std::cout << "BROWSER_PAGE host=" << fields[1] << " status=" << fields[2] << std::endl;
        }
        if (line.rfind("UI_DOMAIN ", 0) == 0 && validHost(line.substr(10)))
            std::cout << "BROWSER_DOMAIN " << line.substr(10) << std::endl;
    }
    return false;
}
void BrowserPilot::stop() {
    if (child.running()) {
        try {
            state("BLOCKED");
        } catch (...) {
        }
    }
    job.terminate();
    child.stop();
    channel.reset();
    wipe(pending);
}
int browserTest(const std::filesystem::path &projectRoot) {
    require(isAdministrator(), "browser-test requires an elevated console");
    protectSupervisor();
    Staging staging;
    staging.allowUserRead();
    Firewall firewall;
    BrowserPilot browser;
    try {
        firewall.install(staging.executable.wstring(), nullptr);
        browser.prepare(staging, projectRoot);
        browser.launch(firewall, true);
        browser.proxyTest(firewall);
        browser.send("TEST_CAS_PREFILL\n");
        require(browser.wait(30000) == "UI_CAS_TEST_DONE", "CAS prefill integration tests failed");
        std::cout << "BROWSER_CAS_TEST prefill=true manual_submit=true origin_guard=true csrf_preserved=true"
                  << std::endl;
        browser.stop();
        firewall.clear();
        std::cout << "RESULT {\"browser_preflight\":true,\"vpn\":\"not_tested\"}" << std::endl;
        return 0;
    } catch (...) {
        browser.stop();
        if (firewall.owns)
            firewall.clear();
        throw;
    }
}
} // namespace neige
