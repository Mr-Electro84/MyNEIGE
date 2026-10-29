#include "session.hpp"
#include "browser.hpp"
#include <winhttp.h>

namespace neige {
static std::atomic<bool> cancelled = false;
static BOOL WINAPI consoleHandler(DWORD event) {
    if (event == CTRL_C_EVENT || event == CTRL_BREAK_EVENT || event == CTRL_CLOSE_EVENT) {
        cancelled = true;
        return TRUE;
    }
    return FALSE;
}
Handle sessionMutex() {
    SECURITY_ATTRIBUTES sa{sizeof(sa), nullptr, FALSE};
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    require(ConvertStringSecurityDescriptorToSecurityDescriptorW(L"D:P(A;;GA;;;SY)(A;;GA;;;BA)", SDDL_REVISION_1,
                                                                 &descriptor, nullptr) != 0,
            "Cannot create session mutex ACL");
    std::unique_ptr<void, decltype(&LocalFree)> cleanup(descriptor, LocalFree);
    sa.lpSecurityDescriptor = descriptor;
    Handle mutex(CreateMutexW(&sa, TRUE, L"Global\\MyNEIGE-PoC-Session-v1"));
    require(mutex.h != nullptr, "Cannot reserve MyNEIGE session");
    require(GetLastError() != ERROR_ALREADY_EXISTS,
            "Another session exists. Close it before retrying (including cleanup)");
    return mutex;
}
void PushOptions::observe(const std::string &line) {
    if (line.rfind(">LOG:", 0) != 0)
        return;
    auto marker = line.find("PUSH_REPLY,");
    if (marker == std::string::npos)
        return;
    auto options = line.substr(marker + 11);
    if (!options.empty() && options.back() == '\'')
        options.pop_back();
    for (const auto &option : split(options, ',')) {
        std::istringstream words(option);
        std::vector<std::string> parts;
        std::string word;
        while (words >> word)
            parts.push_back(word);
        try {
            if (parts.size() == 2 && parts[0] == "route-gateway")
                gateway = ipv4(parts[1]);
            if (parts.size() == 3 && parts[0] == "dhcp-option" && parts[1] == "DNS" && dns.size() < 4) {
                auto ip = ipv4(parts[2]);
                if (std::find(dns.begin(), dns.end(), ip) == dns.end())
                    dns.push_back(ip);
            }
            if (parts.size() >= 5 && parts[0] == "dns" && parts[1] == "server" && parts[3] == "address") {
                for (size_t i = 4; i < parts.size() && dns.size() < 4; ++i) {
                    auto address = parts[i];
                    if (address.find(':') != std::string::npos) {
                        unsupportedDnsPolicy = true; // IPv6 or explicit port requires its own implementation.
                        continue;
                    }
                    auto ip = ipv4(address);
                    if (std::find(dns.begin(), dns.end(), ip) == dns.end())
                        dns.push_back(ip);
                }
            }
            if (parts.size() >= 5 && parts[0] == "dns" && parts[1] == "server" &&
                ((parts[3] == "transport" && parts[4] != "plain") || (parts[3] == "dnssec" && parts[4] != "no")))
                unsupportedDnsPolicy = true;
        } catch (const std::exception &) { /* Not a literal IPv4 option: never infer a system-DNS fallback. */
        }
    }
}
bool isCipherFailure(const std::string &line) {
    return line.find("AUTH_FAILED") != std::string::npos &&
           (line.find("no shared cipher") != std::string::npos ||
            line.find("cipher negotiation failed") != std::string::npos);
}
std::string safeDiagnostic(const std::string &line) {
    if (line.rfind(">HOLD:", 0) == 0)
        return "MANAGEMENT_WAITING_FOR_RELEASE";
    if (line.rfind("SUCCESS: 'Auth' username entered", 0) == 0)
        return "MANAGEMENT_USERNAME_ACCEPTED_LOCALLY";
    if (line.rfind("SUCCESS: 'Auth' password entered", 0) == 0)
        return "MANAGEMENT_PASSWORD_ACCEPTED_LOCALLY";
    if (line == "SUCCESS: hold flag set to OFF")
        return "MANAGEMENT_HOLD_DISABLED";
    if (line == "SUCCESS: hold release succeeded")
        return "MANAGEMENT_HOLD_RELEASED";
    if (line.rfind("ERROR:", 0) == 0)
        return "MANAGEMENT_COMMAND_REJECTED";
    if (line.rfind(">STATE:", 0) == 0) {
        auto fields = split(line.substr(7), ',');
        const std::set<std::string> states{"CONNECTING", "WAIT",       "AUTH",       "GET_CONFIG",
                                           "ASSIGN_IP",  "ADD_ROUTES", "CONNECTED",  "RECONNECTING",
                                           "EXITING",    "RESOLVE",    "TCP_CONNECT"};
        if (fields.size() > 1 && states.count(fields[1]))
            return "STATE_" + fields[1];
    }
    if (isCipherFailure(line))
        return "CIPHER_NEGOTIATION_REJECTED";
    if (line.find("AUTH_FAILED") != std::string::npos || line.find("Verification Failed") != std::string::npos)
        return "AUTHENTICATION_OR_SERVER_POLICY_REJECTED";
    if (line.find("VERIFY ERROR") != std::string::npos)
        return "SERVER_CERTIFICATE_REJECTED";
    if (line.find("TLS Error:") != std::string::npos || line.find("TLS error:") != std::string::npos)
        return "TLS_HANDSHAKE_FAILED";
    if (line.find("RESOLVE:") != std::string::npos && line.find("Cannot resolve") != std::string::npos)
        return "VPN_SERVER_DNS_FAILED";
    if (line.find("TCP: connect to") != std::string::npos && line.find("failed") != std::string::npos)
        return "VPN_SERVER_TCP_CONNECT_FAILED";
    if (line.find("TCP connection established") != std::string::npos)
        return "VPN_SERVER_TCP_CONNECTED";
    if (line.find("VERIFY OK") != std::string::npos)
        return "CERTIFICATE_CHAIN_ELEMENT_VERIFIED";
    if (line.rfind(">FATAL:", 0) == 0)
        return "OPENVPN_FATAL_ERROR";
    return {};
}
static std::string readTextFile(const std::filesystem::path &path) {
    require(!path.empty(), "Explicit --profile path required");
    std::ifstream input(path, std::ios::binary);
    require(bool(input), "Cannot read VPN profile");
    std::string value(65536, '\0');
    input.read(value.data(), static_cast<std::streamsize>(value.size()));
    const auto count = input.gcount();
    require(count > 0 && count < 65536 && !input.bad(), "VPN profile empty, unreadable or too large");
    value.resize(static_cast<size_t>(count));
    return value;
}
static std::string consoleSecret(const char *prompt) {
    DWORD mode = 0;
    require(GetConsoleMode(GetStdHandle(STD_INPUT_HANDLE), &mode) != 0,
            "Credentials require an interactive console; no file/redirected stdin accepted");
    std::cout << prompt << std::endl;
    std::wstring value;
    auto deadline = GetTickCount64() + 90000;
    for (;;) {
        require(!cancelled && GetTickCount64() < deadline, "Credential input cancelled or timed out (90 seconds)");
        if (!_kbhit()) {
            Sleep(30);
            continue;
        }
        wchar_t c = _getwch();
        if (c == L'\r')
            break;
        if (c == 3) {
            cancelled = true;
            throw std::runtime_error("Cancelled");
        }
        if (c == L'\b') {
            if (!value.empty())
                value.pop_back();
            continue;
        }
        if (c == 0 || c == 0xe0) {
            _getwch();
            continue;
        }
        require(c >= 32 && c != 127 && value.size() < 1024, "Invalid credential input");
        value += c;
    }
    std::cout << "\n";
    auto result = utf8(value);
    if (!value.empty())
        SecureZeroMemory(value.data(), value.size() * sizeof(wchar_t));
    require(!result.empty(), "Empty credential");
    return result;
}
struct Credentials {
    std::string username, password;
    ~Credentials() {
        wipe(username);
        wipe(password);
    }
};
struct DedicatedTap {
    Job &job;
    std::filesystem::path tool, journal;
    std::wstring name;
    Adapter identity;
    bool created = false;
    DedicatedTap(Job &owner, const std::filesystem::path &engine, const std::filesystem::path &staging)
        : job(owner), tool(engine.parent_path() / L"tapctl.exe"), journal(staging / L"tap-name.txt") {}
    void create() {
        validateOpenVpn(tool);
        name = wide("MyNEIGE-PoC-" + randomHex(16));
        {
            std::ofstream record(journal);
            require(bool(record) && bool(record << utf8(name) << "\n"), "Cannot record owned TAP identity");
        }
        created = true;
        auto child = job.spawn(tool.wstring(), {L"create", L"--hwid", L"root\\tap0901", L"--name", name}, false);
        require(WaitForSingleObject(child.process.h, 15000) == WAIT_OBJECT_0, "Dedicated TAP creation timed out");
        DWORD code = 1;
        require(GetExitCodeProcess(child.process.h, &code) && code == 0, "Cannot create dedicated TAP adapter");
        child.stop();
        auto deadline = GetTickCount64() + 5000;
        for (;;) {
            try {
                identity = idleAdapterByName(name);
                break;
            } catch (const std::exception &) {
                require(GetTickCount64() < deadline, "Dedicated TAP did not appear idle");
                Sleep(100);
            }
        }
    }
    void remove() {
        if (!created)
            return;
        Job cleanupJob;
        removeOwnedTap(cleanupJob, tool, name);
        require(DeleteFileW(journal.c_str()) != 0, "Cannot remove TAP journal");
        created = false;
    }
};
struct Management {
    Socket socket;
    std::string pending;
    std::deque<std::string> deferred;
    ~Management() {
        wipe(pending);
        for (auto &line : deferred)
            wipe(line);
    }
    void command(const std::string &command) {
        auto frame = managementFrame(command);
        try {
            sendText(socket.s, frame);
        } catch (...) {
            wipe(frame);
            throw;
        }
        wipe(frame);
    }
    std::vector<std::string> read(long timeout) {
        std::vector<std::string> result;
        if (!readable(socket.s, timeout))
            return result;
        char buffer[4096];
        int count = recv(socket.s, buffer, sizeof(buffer), 0);
        require(count > 0, "OpenVPN management disconnected");
        pending.append(buffer, count);
        require(pending.size() <= 131072, "Management line limit exceeded");
        size_t newline = 0;
        while ((newline = pending.find('\n')) != std::string::npos) {
            result.push_back(trim(pending.substr(0, newline)));
            pending.erase(0, newline + 1);
        }
        return result;
    }
    std::vector<std::string> poll(long timeout) {
        std::vector<std::string> result;
        while (!deferred.empty()) {
            result.push_back(std::move(deferred.front()));
            deferred.pop_front();
        }
        auto incoming = read(result.empty() ? timeout : 0);
        for (auto &line : incoming)
            result.push_back(std::move(line));
        return result;
    }
    void exchange(const std::string &value, const std::string &success, const char *publicLabel) {
        command(value);
        auto deadline = GetTickCount64() + 5000;
        bool accepted = false;
        while (!accepted) {
            require(GetTickCount64() < deadline, "OpenVPN management acknowledgement timed out");
            for (auto &line : read(100)) {
                if (line.rfind(success, 0) == 0)
                    accepted = true;
                else if (line.rfind("ERROR:", 0) == 0) {
                    throw std::runtime_error(std::string("OpenVPN rejected management command ") + publicLabel);
                } else {
                    require(deferred.size() < 1024, "Too many deferred management notifications");
                    deferred.push_back(std::move(line));
                }
            }
        }
        // Standalone OpenVPN can flush an acknowledgement from inside its command callback.
        // Preserve asynchronous events and allow that callback to unwind before issuing the next command.
        // Never retry a rejected credential command automatically.
        auto quietDeadline = GetTickCount64() + 2000;
        while (GetTickCount64() < quietDeadline) {
            auto tail = read(100);
            if (tail.empty() && pending.empty())
                return;
            for (auto &line : tail) {
                require(deferred.size() < 1024, "Too many deferred management notifications");
                deferred.push_back(std::move(line));
            }
        }
        throw std::runtime_error("OpenVPN management did not reach a command boundary");
    }
};
struct Internet {
    HINTERNET h = nullptr;
    explicit Internet(HINTERNET value) : h(value) {
        require(h != nullptr, "WinHTTP handle creation failed");
    }
    ~Internet() {
        if (h)
            WinHttpCloseHandle(h);
    }
};
static DWORD httpsHead(uint16_t port, const std::string &token,
                       const wchar_t *host = L"www.appigs.univ-avignon.fr", const wchar_t *path = L"/extranet/etu_suivi.html") {
    require(std::wstring(host) == L"www.appigs.univ-avignon.fr" || publicServiceHost(utf8(host)), "Probe host is not permitted");
    auto proxy = L"127.0.0.1:" + std::to_wstring(port);
    Internet session(
        WinHttpOpen(L"MyNEIGE-PoC/1", WINHTTP_ACCESS_TYPE_NAMED_PROXY, proxy.c_str(), WINHTTP_NO_PROXY_BYPASS, 0));
    require(WinHttpSetTimeouts(session.h, 5000, 5000, 10000, 10000) != 0, "Cannot set HTTPS timeouts");
    BOOL enabled = TRUE;
    require(WinHttpSetOption(session.h, WINHTTP_OPTION_DISABLE_GLOBAL_POOLING, &enabled, sizeof(enabled)) != 0,
            "Cannot disable cross-session connection pooling");
    require(WinHttpSetOption(session.h, WINHTTP_OPTION_SERVER_CERT_CHAIN_BUILD_CACHE_ONLY, &enabled, sizeof(enabled)) !=
                0,
            "Windows WinHTTP cache-only certificate support required; refusing possible out-of-tunnel certificate "
            "downloads");
    DWORD tls = WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_2 | WINHTTP_FLAG_SECURE_PROTOCOL_TLS1_3;
    require(WinHttpSetOption(session.h, WINHTTP_OPTION_SECURE_PROTOCOLS, &tls, sizeof(tls)) != 0,
            "Cannot enforce TLS 1.2/1.3");
    Internet connection(WinHttpConnect(session.h, host, INTERNET_DEFAULT_HTTPS_PORT, 0));
    Internet request(WinHttpOpenRequest(connection.h, L"HEAD", path, nullptr, WINHTTP_NO_REFERER,
                                        WINHTTP_DEFAULT_ACCEPT_TYPES, WINHTTP_FLAG_SECURE));
    DWORD redirects = WINHTTP_OPTION_REDIRECT_POLICY_NEVER;
    require(WinHttpSetOption(request.h, WINHTTP_OPTION_REDIRECT_POLICY, &redirects, sizeof(redirects)) != 0,
            "Cannot disable automatic redirects");
    DWORD logon = WINHTTP_AUTOLOGON_SECURITY_LEVEL_HIGH;
    require(WinHttpSetOption(request.h, WINHTTP_OPTION_AUTOLOGON_POLICY, &logon, sizeof(logon)) != 0,
            "Cannot disable implicit Windows logon");
    // WinHTTP alone owns this proxy credential; it is never sent as origin authentication.
    auto password = wide(token);
    struct WipeWide {
        std::wstring &value;
        ~WipeWide() {
            if (!value.empty())
                SecureZeroMemory(value.data(), value.size() * sizeof(wchar_t));
        }
    } wipePassword{password};
    require(WinHttpSetCredentials(request.h, WINHTTP_AUTH_TARGET_PROXY, WINHTTP_AUTH_SCHEME_BASIC, L"myneige",
                                  password.c_str(), nullptr) != 0,
            "Cannot set proxy credentials");
    for (int attempt = 0; attempt < 2; ++attempt) {
        if (!WinHttpSendRequest(request.h, WINHTTP_NO_ADDITIONAL_HEADERS, 0, WINHTTP_NO_REQUEST_DATA, 0, 0, 0) ||
            !WinHttpReceiveResponse(request.h, nullptr))
            throw std::runtime_error("HTTPS request failed (WinHTTP " + std::to_string(GetLastError()) +
                                     "); no direct fallback");
        DWORD status = 0, size = sizeof(status);
        require(WinHttpQueryHeaders(request.h, WINHTTP_QUERY_STATUS_CODE | WINHTTP_QUERY_FLAG_NUMBER,
                                    WINHTTP_HEADER_NAME_BY_INDEX, &status, &size, WINHTTP_NO_HEADER_INDEX) != 0,
                "Cannot read HTTP status");
        if (status != 407)
            return status;
        require(WinHttpSetCredentials(request.h, WINHTTP_AUTH_TARGET_PROXY, WINHTTP_AUTH_SCHEME_BASIC, L"myneige",
                                      password.c_str(), nullptr) != 0,
                "Cannot answer proxy challenge");
    }
    throw std::runtime_error("Proxy authentication failed");
}
static void rejectUnauthenticated(uint16_t port) {
    Socket client(socket(AF_INET, SOCK_STREAM, IPPROTO_TCP));
    require(client.s != INVALID_SOCKET, "Cannot create unauthorized-client probe");
    socketTimeout(client.s, 5000);
    connectWithin(client.s, endpoint(0x7f000001, port));
    sendText(client.s,
             "CONNECT www.appigs.univ-avignon.fr:443 HTTP/1.1\r\nHost: www.appigs.univ-avignon.fr:443\r\n\r\n");
    char buffer[512]{};
    int count = recv(client.s, buffer, sizeof(buffer) - 1, 0);
    require(count > 0 && std::string(buffer, count).rfind("HTTP/1.1 407 ", 0) == 0,
            "Unauthenticated proxy client was not rejected");
}
static void rejectOtherImageOnTunnel(const Adapter &vpn, uint32_t target) {
    // The controller and the protected relay have different, session-scoped WFP application IDs.
    // Even an explicit source/interface bind by this other image must be rejected before it can connect.
    auto probe = vpnSocket(vpn, SOCK_STREAM, IPPROTO_TCP);
    bool denied = false;
    try {
        connectWithin(probe.s, endpoint(target, 443), 2000);
    } catch (const std::exception &) {
        denied = WSAGetLastError() == WSAEACCES;
    }
    require(denied, "Other executable was not denied VPN access by WSAEACCES; isolation is not demonstrated");
}
static void physicalControlProbe(uint32_t destination) {
    Socket socket(::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP));
    require(socket.s != INVALID_SOCKET, "Cannot create ordinary-application control socket");
    bool connected = false;
    try {
        connectWithin(socket.s, endpoint(destination, 443), 2000);
        connected = true;
    } catch (const std::exception &) {
    }
    sockaddr_in source{};
    int size = sizeof(source);
    require(getsockname(socket.s, reinterpret_cast<sockaddr *>(&source), &size) == 0 && source.sin_port,
            "Cannot identify ordinary-application control flow");
    std::cout << "HOST_CONTROL_FLOW source=" << ipText(ntohl(source.sin_addr.S_un.S_addr)) << ":"
              << ntohs(source.sin_port) << " destination=" << ipText(destination)
              << ":443 connected=" << (connected ? "true" : "false") << std::endl;
}
int inspect(const Options &options) {
    auto profile = normalizeProfile(readTextFile(options.profile));
    std::cout << "PROFILE_VALIDATED normalized_bytes=" << profile.size() << "\n";
    std::cout << "ADMIN=" << (isAdministrator() ? "yes" : "no") << "\n";
    std::cout << "OPENVPN_PRESENT=" << (std::filesystem::is_regular_file(options.openvpn) ? "yes" : "no") << "\n";
    if (std::filesystem::is_regular_file(options.openvpn)) {
        validateOpenVpn(options.openvpn);
        std::cout << "OPENVPN_SIGNATURE=verified\n";
    }
    Internet http(WinHttpOpen(L"MyNEIGE-PoC-preflight", WINHTTP_ACCESS_TYPE_NO_PROXY, WINHTTP_NO_PROXY_NAME,
                              WINHTTP_NO_PROXY_BYPASS, 0));
    BOOL cacheOnly = TRUE;
    require(
        WinHttpSetOption(http.h, WINHTTP_OPTION_SERVER_CERT_CHAIN_BUILD_CACHE_ONLY, &cacheOnly, sizeof(cacheOnly)) != 0,
        "WinHTTP cache-only certificate support unavailable on this Windows build");
    std::cout << "WINHTTP_CERTIFICATE_CACHE_ONLY=supported\n";
    auto network = NetworkSnapshot::capture();
    std::cout << "BASELINE routes=" << network.routes.size() << " active_interfaces=" << network.interfaces.size()
              << "\n";
    std::cout << "No network changes performed. connect and wfp-test require administrator rights.\n";
    return 0;
}
int wfpTest() {
    require(isAdministrator(), "wfp-test requires an elevated console");
    auto mutex = sessionMutex();
    Staging staging;
    staging.allowUserRead();
    Firewall firewall;
    Job job;
    Child child;
    try {
        uint16_t port = 0;
        auto listener = loopbackListener(port);
        Socket control(socket(AF_INET, SOCK_STREAM, IPPROTO_TCP));
        connectWithin(control.s, endpoint(0x7f000001, port));
        Socket listener6(socket(AF_INET6, SOCK_STREAM, IPPROTO_TCP));
        require(listener6.s != INVALID_SOCKET, "IPv6 loopback unavailable; IPv6 quarantine cannot be certified");
        sockaddr_in6 local6{};
        local6.sin6_family = AF_INET6;
        local6.sin6_addr = in6addr_loopback;
        require(bind(listener6.s, reinterpret_cast<sockaddr *>(&local6), sizeof(local6)) == 0 &&
                    listen(listener6.s, 8) == 0,
                "Cannot create IPv6 control listener");
        int length6 = sizeof(local6);
        require(getsockname(listener6.s, reinterpret_cast<sockaddr *>(&local6), &length6) == 0,
                "Cannot read IPv6 test port");
        firewall.install(staging.executable.wstring(), nullptr);
        // Reopen the management handle: installed quarantine must survive its owner's disconnect.
        wincheck(FwpmEngineClose0(firewall.engine), "Close WFP management connection");
        firewall.engine = nullptr;
        wincheck(FwpmEngineOpen0(nullptr, RPC_C_AUTHN_WINNT, nullptr, nullptr, &firewall.engine),
                 "Reopen WFP management connection");
        Socket unaffected(socket(AF_INET, SOCK_STREAM, IPPROTO_TCP));
        connectWithin(unaffected.s, endpoint(0x7f000001, port));
        Socket unaffected6(socket(AF_INET6, SOCK_STREAM, IPPROTO_TCP));
        connectWithinAddress(unaffected6.s, reinterpret_cast<sockaddr *>(&local6), sizeof(local6));
        child = job.spawn(staging.executable.wstring(), {L"blocked-probe", std::to_wstring(port)});
        auto result = child.line(5000);
        require(result == "BLOCK_RESULT 10013",
                "Quarantine was not proven by WSAEACCES; no VPN test should be started");
        child.stop();
        child =
            job.spawn(staging.executable.wstring(), {L"blocked-probe-v6", std::to_wstring(ntohs(local6.sin6_port))});
        result = child.line(5000);
        require(result == "BLOCK_RESULT 10013", "IPv6 quarantine was not proven by WSAEACCES");
        child.stop();
        // Exercise the actual permit rule (application + source + LUID), not just quarantine/removal.
        // install(nullptr) above did not block other applications on the loopback interface.
        firewall.allowVpn(staging.executable.wstring(), adapterFor(0x7f000001));
        child = job.spawn(staging.executable.wstring(), {L"bound-probe", std::to_wstring(port)});
        auto permitResult = child.line(5000);
        if (permitResult != "UNEXPECTED_CONNECT")
            std::cout << "LOCAL_BOUND_PROBE_FAILURE " << permitResult << std::endl;
        require(permitResult == "UNEXPECTED_CONNECT", "Verified source/interface WFP permit did not work");
        child.stop();
        firewall.clear();
        child = job.spawn(staging.executable.wstring(), {L"blocked-probe", std::to_wstring(port)});
        require(child.line(5000) == "UNEXPECTED_CONNECT", "Relay could not connect after owned WFP cleanup");
        child.stop();
        std::cout << "RESULT "
                     "{\"wfp_quarantine_ipv4\":\"passed\",\"wfp_quarantine_ipv6\":\"passed\",\"survives_engine_"
                     "disconnect\":true,\"source_interface_permit\":true,\"other_image_unaffected\":true,\"cleanup_"
                     "verified\":true,\"vpn\":\"not_"
                     "tested\",\"routing_changes\":false}\n";
        return 0;
    } catch (...) {
        child.stop();
        if (firewall.owns)
            firewall.clear();
        throw;
    }
}
static void verifyNetworkSnapshot(const NetworkSnapshot &baseline, const NetworkSnapshot &current,
                                  const char *message) {
    if (baseline.routes == current.routes && baseline.interfaces == current.interfaces)
        return;
    // Only IP configuration metadata is reported; never management messages or credentials.
    for (const auto &route : baseline.routes)
        if (!current.routes.count(route))
            std::cout << "NETWORK_DIFF removed_route=" << route << std::endl;
    for (const auto &route : current.routes)
        if (!baseline.routes.count(route))
            std::cout << "NETWORK_DIFF added_route=" << route << std::endl;
    for (const auto &[luid, value] : baseline.interfaces) {
        auto found = current.interfaces.find(luid);
        if (found == current.interfaces.end() || found->second != value)
            std::cout << "NETWORK_DIFF previous_interface=" << luid << ":" << value << std::endl;
    }
    for (const auto &[luid, value] : current.interfaces) {
        auto found = baseline.interfaces.find(luid);
        if (found == baseline.interfaces.end() || found->second != value)
            std::cout << "NETWORK_DIFF current_interface=" << luid << ":" << value << std::endl;
    }
    throw std::runtime_error(message);
}
int adapterTest(const Options &options) {
    require(isAdministrator(), "adapter-test requires an elevated console");
    auto mutex = sessionMutex();
    auto baseline = NetworkSnapshot::capture();
    Staging staging;
    Job job;
    DedicatedTap tap(job, std::filesystem::absolute(options.openvpn), staging.directory);
    Firewall firewall;
    try {
        tap.create();
        firewall.install(staging.executable.wstring(), &tap.identity);
        auto during = NetworkSnapshot::capture(tap.identity.luid);
        verifyNetworkSnapshot(baseline, during, "Host network changed during adapter test");
        tap.remove();
        firewall.clear();
        auto after = NetworkSnapshot::capture();
        verifyNetworkSnapshot(baseline, after, "Adapter cleanup did not restore baseline");
        std::cout << "RESULT "
                     "{\"dedicated_tap\":\"passed\",\"quarantine_before_tunnel\":true,\"baseline_restored\":true,"
                     "\"vpn\":\"not_tested\"}\n";
        return 0;
    } catch (...) {
        tap.remove();
        if (firewall.owns)
            firewall.clear();
        throw;
    }
}
int connectSession(const Options &options) {
    const auto startupStarted = GetTickCount64();
    require(isAdministrator(), "connect requires an elevated console");
    if (options.browserMode)
        selectInteractiveUser();
    protectSupervisor();
    require(options.seconds >= 1 && options.seconds <= (options.browserMode ? browserSessionSeconds : 60u), "Invalid pilot duration");
    auto mutex = sessionMutex();
    validateOpenVpn(options.openvpn);
    auto config = options.browserMode ? std::string{} : normalizeProfile(readTextFile(options.profile));
    Socket localTestServer;
    if (options.localManagementTest) {
        uint16_t localPort = 0;
        localTestServer = loopbackListener(localPort);
        auto position = config.find("\nremote ");
        require(position != std::string::npos, "Local management fixture cannot find normalized remote");
        ++position;
        config.replace(position, config.find('\n', position) - position,
                       "remote 127.0.0.1 " + std::to_string(localPort));
    }
    auto baseline = NetworkSnapshot::capture();
    Staging staging;
    Job job;
    Child openvpn, relay;
    // Choix figé avant la création du tunnel ; aucun proxy/DNS système modifié.
    const auto usualNetwork = options.browserMode ? publicNetwork() : Adapter{};
    PublicRelay publicRelay;
    std::unique_ptr<BrowserPilot> browser;
    Management management;
    OwnedRoute route;
    Firewall firewall;
    PushOptions pushed;
    DedicatedTap tap(job, std::filesystem::absolute(options.openvpn), staging.directory);
    std::string token = randomHex();
    bool success = false;
    uint64_t vpnLuid = 0;
    std::string lastDiagnostic = "INITIALIZATION";
    std::set<std::string> reportedDiagnostics;
    cancelled = false;
    SetConsoleCtrlHandler(consoleHandler, TRUE);
    auto stopNetwork = [&] {
        relay.stop();
        publicRelay.child.stop();
        try {
            if (management.socket.s != INVALID_SOCKET)
                management.command("signal SIGTERM");
        } catch (...) {
        }
        if (openvpn.running())
            WaitForSingleObject(openvpn.process.h, 3000);
        openvpn.stop();
        job.terminate();
        management.socket.reset();
        route.remove();
        tap.remove();
    };
    auto cleanup = [&] {
        // Kill/join all emitters before touching route or WFP; persistent WFP is retained if route cleanup fails.
        if (browser)
            browser->stop();
        stopNetwork();
        if (firewall.owns)
            firewall.clear();
        wipe(token);
    };
    try {
        tap.create();
        std::cout << "STARTUP_TAP elapsed_ms=" << GetTickCount64() - startupStarted << std::endl;
        firewall.install(staging.executable.wstring(), &tap.identity);
        if (options.browserMode) {
            staging.allowUserRead();
            browser = std::make_unique<BrowserPilot>();
            browser->prepare(staging, options.projectRoot);
            std::cout << "STARTUP_BROWSER_PREPARED elapsed_ms=" << GetTickCount64() - startupStarted << std::endl;
            browser->launch(firewall);
            std::cout << "STARTUP_FORM_READY elapsed_ms=" << GetTickCount64() - startupStarted << std::endl;
            config = browser->profile();
        }
        {
            std::ofstream file(staging.profile, std::ios::binary);
            require(bool(file) && bool(file << config), "Cannot write protected VPN configuration");
        }
        uint16_t managementPort = 0;
        auto listener = loopbackListener(managementPort);
        auto managementToken = randomHex();
        openvpn = job.spawn(std::filesystem::absolute(options.openvpn).wstring(),
                            {L"--config", staging.profile.wstring(), L"--dev-node", tap.name, L"--management",
                             L"127.0.0.1", std::to_wstring(managementPort), L"stdin", L"--management-client",
                             L"--management-hold", L"--management-query-passwords"},
                            false);
        writePipe(openvpn.input.h, managementToken + "\n");
        openvpn.input.reset();
        std::cout << "OPENVPN_STARTING (no raw logs are recorded)\n";
        auto deadline = GetTickCount64() + 30000;
        sockaddr_in remote{};
        int remoteLength = sizeof(remote);
        while (!readable(listener.s, 200)) {
            require(!cancelled && openvpn.running() && GetTickCount64() < deadline,
                    "OpenVPN did not establish its management channel");
        }
        management.socket = Socket(accept(listener.s, reinterpret_cast<sockaddr *>(&remote), &remoteLength));
        require(management.socket.s != INVALID_SOCKET, "Cannot accept OpenVPN control");
        sockaddr_in local{};
        int localLength = sizeof(local);
        require(getsockname(management.socket.s, reinterpret_cast<sockaddr *>(&local), &localLength) == 0,
                "Cannot inspect control endpoint");
        require(tcpOwner(local, remote) == openvpn.pid, "Management peer is not the supervised OpenVPN process");
        listener.reset();
        socketTimeout(management.socket.s, 5000);
        // The password prompt does not end in a newline. Consume it explicitly before the line protocol.
        std::string greeting;
        deadline = GetTickCount64() + 10000;
        while (greeting.find("ENTER PASSWORD:") == std::string::npos) {
            require(GetTickCount64() < deadline, "OpenVPN management authentication prompt missing");
            if (readable(management.socket.s, 100)) {
                char c = 0;
                require(recv(management.socket.s, &c, 1, 0) == 1, "Control disconnected");
                greeting += c;
                require(greeting.size() < 4096, "Unexpected management greeting");
            }
        }
        management.exchange(managementToken, "SUCCESS: password is correct", "AUTHENTICATE_CHANNEL");
        wipe(managementToken);
        management.exchange("state on", "SUCCESS: real-time state notification set to ON", "ENABLE_STATE");
        management.exchange("log on all", "SUCCESS: real-time log notification set to ON", "ENABLE_LOG_METADATA");
        management.exchange("hold off", "SUCCESS: hold flag set to OFF", "DISABLE_HOLD");
        management.exchange("hold release", "SUCCESS: hold release succeeded", "RELEASE_HOLD");
        uint32_t localIp = 0;
        deadline = GetTickCount64() + 120000;
        bool authSent = false;
        while (!localIp) {
            require(!cancelled, "VPN connection cancelled by user");
            require(GetTickCount64() < deadline, "VPN connection timed out; inspect the sanitized VPN_DIAGNOSTIC");
            if (options.localManagementTest && authSent && readable(localTestServer.s, 0)) {
                sockaddr_in peer{}, localAddress{};
                int size = sizeof(peer);
                Socket accepted(accept(localTestServer.s, reinterpret_cast<sockaddr *>(&peer), &size));
                require(accepted.s != INVALID_SOCKET, "Local test accept failed");
                size = sizeof(localAddress);
                require(getsockname(accepted.s, reinterpret_cast<sockaddr *>(&localAddress), &size) == 0 &&
                            tcpOwner(localAddress, peer) == openvpn.pid,
                        "Local test connection is not from supervised OpenVPN");
                cleanup();
                SetConsoleCtrlHandler(consoleHandler, FALSE);
                std::cout << "RESULT {\"local_management_credentials\":\"accepted\",\"hold_release\":\"passed\","
                             "\"loopback_connect_pid\":\"verified\",\"university_contacted\":false,"
                             "\"real_credentials\":false}\n";
                return 0;
            }
            // Drain management events even after process exit, otherwise AUTH_FAILED/FATAL can be lost.
            for (auto &line : management.poll(200)) {
                auto diagnostic = safeDiagnostic(line);
                if (!diagnostic.empty()) {
                    lastDiagnostic = diagnostic;
                    if (reportedDiagnostics.insert(diagnostic).second)
                        std::cout << "VPN_EVENT " << diagnostic << std::endl;
                }
                pushed.observe(line);
                if (line.rfind(">HOLD:", 0) == 0) {
                    management.exchange("hold off", "SUCCESS: hold flag set to OFF", "DISABLE_HOLD");
                    management.exchange("hold release", "SUCCESS: hold release succeeded", "RELEASE_HOLD");
                }
                if (line == ">PASSWORD:Need 'Auth' username/password") {
                    if (options.authenticationProbe) {
                        cleanup();
                        SetConsoleCtrlHandler(consoleHandler, FALSE);
                        std::cout << "RESULT "
                                     "{\"openvpn_management\":\"authenticated\",\"peer_pid\":\"verified\",\"credential_"
                                     "request\":\"received\",\"credentials_submitted\":false,\"vpn_authentication\":"
                                     "\"not_tested\"}\n";
                        return 0;
                    }
                    require(!authSent, "Unexpected repeated authentication; restart the session explicitly");
                    Credentials credentials;
                    if (browser) {
                        auto submitted = browser->credentials();
                        credentials.username.swap(submitted.first);
                        credentials.password.swap(submitted.second);
                    } else {
                        credentials.username = options.localManagementTest
                                                   ? "myneige-local-protocol-test"
                                                   : consoleSecret("Identifiant UAPV (saisie masquee) : ");
                        credentials.password = options.localManagementTest
                                                   ? randomHex()
                                                   : consoleSecret("Mot de passe UAPV (saisie masquee) : ");
                    }
                    auto username = "username \"Auth\" " + managementQuote(credentials.username);
                    auto password = "password \"Auth\" " + managementQuote(credentials.password);
                    try {
                        management.exchange(username, "SUCCESS: 'Auth' username entered", "SUBMIT_USERNAME");
                        management.exchange(password, "SUCCESS: 'Auth' password entered", "SUBMIT_PASSWORD");
                    } catch (...) {
                        wipe(username);
                        wipe(password);
                        throw;
                    }
                    wipe(username);
                    wipe(password);
                    authSent = true;
                    deadline = GetTickCount64() + (options.localManagementTest ? 15000 : 90000);
                } else if (line.rfind(">PASSWORD:", 0) == 0)
                    throw std::runtime_error(
                        "VPN authentication failed or requires an unsupported challenge; no secret was logged");
                if (isCipherFailure(line))
                    throw std::runtime_error("VPN data-cipher negotiation failed");
                if (line.rfind(">FATAL:", 0) == 0)
                    throw std::runtime_error(
                        "OpenVPN reported a fatal error; check version, driver and profile compatibility");
                if (line.rfind(">STATE:", 0) == 0) {
                    auto state = split(line.substr(7), ',');
                    if (state.size() >= 4 && state[1] == "CONNECTED" && state[2] == "SUCCESS")
                        localIp = ipv4(state[3]);
                }
                wipe(line);
            }
            if (!openvpn.running() && !readable(management.socket.s, 0))
                throw std::runtime_error("OpenVPN process exited; inspect the sanitized VPN_DIAGNOSTIC");
        }
        std::cout << "VPN_METADATA assigned_ipv4=" << ipText(localIp) << " pushed_dns=";
        for (size_t i = 0; i < pushed.dns.size(); ++i)
            std::cout << (i ? "," : "") << ipText(pushed.dns[i]);
        std::cout << " pushed_gateway=" << (pushed.gateway ? ipText(pushed.gateway) : "unavailable") << std::endl;
        // CONNECTED may precede completion of Windows duplicate address detection after netsh assignment.
        // Never open the relay or grant its WFP permit until the address is actually usable for bind().
        Adapter vpn;
        auto addressDeadline = GetTickCount64() + 10000;
        for (;;) {
            try {
                vpn = adapterFor(localIp);
                break;
            } catch (const std::exception &) {
                require(!cancelled && openvpn.running() && GetTickCount64() < addressDeadline,
                        "VPN IPv4 address did not become preferred and usable within 10 seconds");
                Sleep(100);
            }
        }
        std::cout << "VPN_ADDRESS_PREFERRED\n";
        reportTransport(openvpn.pid);
        std::cout << "VPN_INTERFACE index=" << vpn.index << " luid=" << vpn.luid << " guid=" << vpn.guid << std::endl;
        std::cout << "SESSION_GENERATION id=" << utf8(staging.directory.filename().wstring()) << std::endl;
        require(vpn.dns.empty(), "Unexpected IPv4 DNS assigned to the VPN interface; host DNS isolation not validated");
        vpnLuid = vpn.luid;
        require(vpn.luid == tap.identity.luid && vpn.index == tap.identity.index && vpn.guid == tap.identity.guid &&
                    vpn.name == tap.identity.name && !baseline.interfaces.count(vpn.luid),
                "OpenVPN did not use its dedicated quarantined adapter");
        auto afterConnect = NetworkSnapshot::capture(vpn.luid);
        verifyNetworkSnapshot(baseline, afterConnect,
                              "Host routes or DNS changed during VPN setup; pilot aborted before traffic");
        auto dns = options.dns.empty() ? pushed.dns : options.dns;
        auto gateway = options.gateway ? options.gateway : pushed.gateway;
        require(!pushed.unsupportedDnsPolicy, "VPN requires a DNS transport, port or DNSSEC policy not implemented by "
                                              "this pilot; no downgrade attempted");
        require(!dns.empty(),
                "No IPv4 VPN DNS metadata received. Supply a university-verified --dns address; do not guess");
        require(gateway != 0, "No VPN gateway metadata received. Supply a verified --gateway; do not guess");
        firewall.allowVpn(staging.executable.wstring(), vpn);
        route.add(vpn, gateway);
        staging.allowUserRead();
        if (options.browserMode) {
            require(usualNetwork.luid != vpn.luid, "Public network must be distinct from the protected VPN");
            publicRelay.start(job, firewall, staging, usualNetwork, token);
            firewall.allowBrowserProxy(staging.executable.wstring(), publicRelay.port);
            std::cout << "PUBLIC_RELAY_READY interface=" << usualNetwork.index << " source=" << ipText(usualNetwork.address)
                      << " protected_services=VPN public_services=usual_network" << std::endl;
        }
        relay = job.spawn(staging.executable.wstring(), {L"relay-worker"}, true, true);
        std::string configuration = relayConfiguration(vpn, dns, "www.appigs.univ-avignon.fr", token,
            options.browserMode ? "university" : "appigs", publicRelay.port);
        writePipe(relay.input.h, configuration);
        wipe(configuration);
        std::string readyLine;
        for (unsigned attempt = 0; attempt < 32; ++attempt) {
            readyLine = relay.line(30000);
            if (!safeRelayDiagnostic(readyLine) && readyLine.rfind("DNS_BIND_FAILURE ", 0) != 0 &&
                readyLine.rfind("VPN_FLOW ", 0) != 0 && readyLine != "DNS_UDP_TCP_VALIDATED")
                break;
            // This is generated by our worker, not raw network or management input.
            std::cout << readyLine << std::endl;
        }
        if (readyLine == "ERROR: All VPN DNS servers failed; no system-DNS fallback was attempted")
            throw std::runtime_error("Tunnel DNS resolution failed; inspect DNS_ATTEMPT_FAILED, no fallback used");
        auto ready = split(readyLine, ' ');
        require(ready.size() == 3 && ready[0] == "READY", "Relay could not validate tunnel DNS or bind its listener");
        auto parsedPort = std::stoul(ready[1]);
        require(parsedPort > 0 && parsedPort <= 65535, "Invalid proxy port");
        auto port = static_cast<uint16_t>(parsedPort);
        std::cout << "PROXY_ENDPOINT port=" << port << std::endl;
        std::cout << "SUPERVISED_PROCESS openvpn_pid=" << openvpn.pid << " relay_pid=" << relay.pid << std::endl;
        auto targets = split(ready[2], ',');
        for (auto &address : targets) {
            require(defaultInterfaceFor(ipv4(address)) != vpn.index,
                    "Unbound host traffic would use the VPN; pilot stopped");
            std::cout << "TARGET_IPV4 " << ipText(ipv4(address)) << " unbound_route_uses_vpn=false\n";
        }
        require(!targets.empty(), "No target address for the tunnel exclusion test");
        if (options.qualification)
            physicalControlProbe(ipv4(targets.front()));
        rejectOtherImageOnTunnel(vpn, ipv4(targets.front()));
        std::cout << "OTHER_IMAGE_TUNNEL_BIND_DENIED\n";
        rejectUnauthenticated(port);
        std::cout << "PROXY_UNAUTHENTICATED_REJECTED\n";
        DWORD status = httpsHead(port, token);
        require(status >= 200 && status < 500 && status != 407, "Unexpected target HTTP response");
        std::cout << "HTTPS_TLS_VERIFIED status=" << status << " (HEAD only; no student page body collected)\n";
        if (browser)
            browser->ready(firewall, port, token);
        std::cout << "STARTUP_VPN_READY elapsed_ms=" << GetTickCount64() - startupStarted << std::endl;
        if (options.qualification) {
            // Remove only our own low-priority tunnel route. Host connectivity is never disabled.
            route.remove();
            bool denied = false;
            try {
                denied = httpsHead(port, token) >= 500;
            } catch (const std::exception &) {
                denied = true;
            }
            require(denied, "Request succeeded without the owned VPN route");
            std::cout << "OWNED_ROUTE_LOSS_REQUEST_BLOCKED" << std::endl;
            route.add(vpn, gateway);
            auto recoveredStatus = httpsHead(port, token);
            require(recoveredStatus >= 200 && recoveredStatus < 500 && recoveredStatus != 407,
                    "Request did not recover after restoring the owned route");
            std::cout << "OWNED_ROUTE_RESTORED_HTTPS status=" << recoveredStatus << std::endl;
        }
        std::cout << "READY_FOR_CAPTURE duration_seconds=" << options.seconds << ". Ctrl+C stops the session.\n";
        SessionLifetime lifetime(GetTickCount64(), options.seconds);
        bool userStopped = false;
        auto nextProbe = GetTickCount64() + 5000;
        while (!cancelled && !lifetime.expired(GetTickCount64())) {
            if (browser && browser->wantsStop()) {
                userStopped = true;
                break;
            }
            for (unsigned n = 0; n < 64; ++n) {
                auto output = relay.pollLine();
                if (output.empty())
                    break;
                if (output.rfind("VPN_FLOW ", 0) == 0 || output.rfind("FLOW ", 0) == 0 || output == "REQUEST_FAILED" || safeRelayDiagnostic(output))
                    std::cout << output << std::endl;
            }
            if (options.browserMode) {
                for (unsigned n = 0; n < 64; ++n) {
                    const auto output = publicRelay.child.pollLine();
                    if (output.empty()) break;
                    if (output.rfind("PUBLIC_FLOW ", 0) == 0 || safeRelayDiagnostic(output)) std::cout << output << std::endl;
                }
                require(publicRelay.child.running(), "Public relay exited; session stopped without fallback");
            }
            require(openvpn.running() && relay.running(), "A supervised network process exited");
            auto current = adapterFor(localIp);
            require(current.dns.empty(), "VPN interface DNS changed; session blocked");
            require(current.luid == vpn.luid && current.index == vpn.index && current.guid == vpn.guid &&
                        current.name == vpn.name,
                    "VPN identity changed");
            auto snapshot = NetworkSnapshot::capture(vpn.luid);
            verifyNetworkSnapshot(baseline, snapshot, "Host network changed; session blocked");
            for (auto &address : targets)
                require(defaultInterfaceFor(ipv4(address)) != vpn.index,
                        "Host would fall back to VPN; session blocked");
            for (auto &line : management.poll(200)) {
                if (line.rfind(">STATE:", 0) == 0) {
                    auto state = split(line.substr(7), ',');
                    if (state.size() > 1 && state[1] != "CONNECTED")
                        throw std::runtime_error("Tunnel left CONNECTED; restart required, no reconnection fallback");
                }
                if (line.rfind(">PASSWORD:", 0) == 0 || line.rfind(">FATAL:", 0) == 0)
                    throw std::runtime_error("Tunnel requires renewed authentication or failed");
                wipe(line);
            }
            // Une prolongation n'est acceptée qu'avant l'échéance et après
            // les contrôles de santé du tunnel ; elle ne reconnecte rien.
            if (browser) {
                if (browser->extendRequested) {
                    browser->extendRequested = false;
                    if (lifetime.extend(GetTickCount64())) {
                        browser->send("SESSION_EXTENDED\n");
                        std::cout << "SESSION_EXTENDED duration_seconds=" << browserSessionSeconds << std::endl;
                    }
                }
                const auto now = GetTickCount64();
                if (lifetime.warn(now))
                    browser->send("SESSION_WARNING " + std::to_string(lifetime.remainingSeconds(now)) + "\n");
            }
            if (!browser && GetTickCount64() >= nextProbe) {
                auto probeStatus = httpsHead(port, token);
                require(probeStatus >= 200 && probeStatus < 500 && probeStatus != 407, "Repeated HTTPS probe failed");
                std::cout << "HTTPS_PROBE status=" << probeStatus << "\n";
                nextProbe = GetTickCount64() + 5000;
            }
        }
        if (options.crashAfterProbes) {
            std::cout << "CONTROLLED_CONTROLLER_CRASH exit=86" << std::endl;
            TerminateProcess(GetCurrentProcess(), 86);
            ExitProcess(86);
        }
        const bool expired = browser && !cancelled && !userStopped && lifetime.expired(GetTickCount64());
        if (expired) {
            // Le formulaire local reste confiné pendant l'explication de fin.
            firewall.revokeBrowserProxy(browser->executable.wstring());
            browser->send("SESSION_EXPIRED\n");
            stopNetwork();
            std::cout << "SESSION_EXPIRED\n";
            // Garder WFP, le job Electron et le pipe jusqu'à la fermeture du
            // seul écran local. Une perte du contrôleur conserve l'arrêt forcé.
            while (!cancelled && !browser->wantsStop()) Sleep(200);
        } else {
            // Controlled tunnel loss. The relay remains quarantined while testing its failure response.
            if (browser) browser->stop();
            openvpn.stop();
            bool blocked = false;
            try {
                auto failedStatus = httpsHead(port, token);
                blocked = failedStatus >= 500;
            } catch (const std::exception &) {
                blocked = true;
            }
            require(blocked, "Request unexpectedly succeeded after tunnel loss");
            std::cout << "TUNNEL_LOSS_REQUEST_BLOCKED (packet capture still required to prove no physical leakage)\n";
            relay.stop();
            blocked = false;
            try {
                httpsHead(port, token);
            } catch (const std::exception &) {
                blocked = true;
            }
            require(blocked, "Request unexpectedly succeeded with stopped relay");
            std::cout << "RELAY_LOSS_REQUEST_BLOCKED\n";
        }
        success = true;
        cleanup();
        auto restored = NetworkSnapshot::capture();
        verifyNetworkSnapshot(baseline, restored,
                              "Host network restoration differs from baseline; inspect before continuing");
        std::cout << "RESULT "
                     "{\"live_https\":true,\"proxy_auth\":true,\"tunnel_loss_blocked\":"
                  << (expired ? "null" : "true") << ",\"relay_loss_blocked\":" << (expired ? "null" : "true")
                  << ",\"other_image_tunnel_bind_blocked\":true,\"packet_capture\":\"manual_required\","
                     "\"electron\":\""
                  << (options.browserMode ? "pilot_started" : "not_used")
                  << "\",\"feasibility\":"
                     "\"not_yet_certified\"}\n";
    } catch (...) {
        DWORD processCode = 0;
        if (openvpn.process.h)
            GetExitCodeProcess(openvpn.process.h, &processCode);
        std::cout << "VPN_DIAGNOSTIC " << lastDiagnostic << " process_code=" << processCode << std::endl;
        try {
            cleanup();
        } catch (...) {
            std::cerr << "Cleanup incomplete: persistent WFP protection retained; run cleanup before retrying.\n";
        }
        SetConsoleCtrlHandler(consoleHandler, FALSE);
        throw;
    }
    SetConsoleCtrlHandler(consoleHandler, FALSE);
    static_cast<void>(vpnLuid);
    return success ? 0 : 1;
}
int publicNetworkTest() {
    require(isAdministrator(), "Public-network test requires an elevated console");
    selectInteractiveUser();
    auto mutex = sessionMutex();
    protectSupervisor();
    const auto baseline = NetworkSnapshot::capture();
    const auto network = publicNetwork();
    Staging staging;
    staging.allowUserRead();
    Firewall firewall;
    Job job;
    PublicRelay relay;
    auto token = randomHex();
    try {
        firewall.install(staging.executable.wstring(), nullptr);
        relay.start(job, firewall, staging, network, token);
        for (const auto &target : {std::pair{L"partage.univ-avignon.fr", L"/"},
                                   std::pair{L"www.youtube.com", L"/iframe_api"}}) {
            const auto status = httpsHead(relay.port, token, target.first, target.second);
            require(status >= 200 && status < 400, "Public service HEAD did not succeed");
            std::cout << "PUBLIC_NETWORK_HEAD host=" << utf8(target.first) << " status=" << status
                      << " tls_verified=true no_account=true" << std::endl;
        }
        for (unsigned i = 0; i < 32; ++i) {
            const auto line = relay.child.pollLine();
            if (line.empty()) break;
            if (line.rfind("PUBLIC_FLOW ", 0) == 0 || safeRelayDiagnostic(line)) std::cout << line << std::endl;
        }
        relay.child.stop();
        firewall.clear();
        wipe(token);
        verifyNetworkSnapshot(baseline, NetworkSnapshot::capture(), "Public test modified host network configuration");
        std::cout << "PUBLIC_NETWORK_TEST passed=true dns_bound=true routes_unchanged=true vpn=not_tested" << std::endl;
        return 0;
    } catch (...) {
        relay.child.stop();
        if (firewall.owns) firewall.clear();
        wipe(token);
        throw;
    }
}
} // namespace neige
