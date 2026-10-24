#include "session.hpp"
#include "startup.hpp"

namespace neige {
int selfTest() {
    unsigned passed = 0;
    auto test = [&](const char *name, const std::function<void()> &fn) {
        fn();
        ++passed;
        std::cout << "PASS " << name << "\n";
    };
    auto rejects = [](const std::function<void()> &fn) {
        bool rejected = false;
        try {
            fn();
        } catch (const std::exception &) {
            rejected = true;
        }
        require(rejected, "Expected rejection did not occur");
    };
    test("SHA256 matches standard empty and abc vectors", [] {
        require(sha256Text("") == "E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855",
                "Empty SHA256 mismatch");
        require(sha256Text("abc") == "BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD",
                "SHA256 abc mismatch");
    });
    test("host snapshot tolerates automatic metric variation only", [] {
        Adapter adapter;
        adapter.address = 0xc0a80101;
        adapter.dns = {0xc0a801fe};
        MIB_IPINTERFACE_ROW row{};
        row.UseAutomaticMetric = TRUE;
        row.Metric = 35;
        auto before = interfaceSignature(adapter, row);
        row.Metric = 40;
        require(before == interfaceSignature(adapter, row), "Automatic Wi-Fi metric should not abort the pilot");
        row.UseAutomaticMetric = FALSE;
        require(before != interfaceSignature(adapter, row), "Metric policy changes must be detected");
        before = interfaceSignature(adapter, row);
        row.Metric = 41;
        require(before != interfaceSignature(adapter, row), "Fixed metric changes must be detected");
        row.Metric = 40;
        row.WeakHostReceive = TRUE;
        require(before != interfaceSignature(adapter, row), "Weak-host receive changes must be detected");
        row.WeakHostReceive = FALSE;
        adapter.dns.clear();
        require(before != interfaceSignature(adapter, row), "DNS changes must be detected");
    });
    test("management escaping", [] { require(managementQuote("a\\b\"c") == "\"a\\\\b\\\"c\"", "Escaping mismatch"); });
    test("management newline/NUL injection", [&] {
        rejects([] { managementQuote("pass\nsignal SIGTERM"); });
        rejects([] { managementQuote(std::string("a\0b", 3)); });
    });
    test("Windows argument escaping", [] {
        require(quoteArgument(L"C:\\space path\\") == L"\"C:\\space path\\\\\"",
                "Windows trailing slash quote mismatch");
    });
    test("hostname validation", [] {
        require(validHost("www.appigs.univ-avignon.fr") && !validHost("-bad.test") && !validHost("a..b") &&
                    !validHost("a/b") && !validHost("a.test."),
                "Hostname validation mismatch");
    });
    test("university scope rejects suffix lookalikes and local names", [] {
        require(universityHost("cas.univ-avignon.fr") && universityHost("univ-avignon.fr") &&
                    !universityHost("univ-avignon.fr.attacker.test") && !universityHost("eviluniv-avignon.fr") &&
                    !universityHost("127.0.0.1") && !universityHost("a..univ-avignon.fr"),
                "University scope mismatch");
    });
    const std::string base =
        "dev tun\nclient\nremote vpn.example.test 443 tcp-client\nauth-user-pass\nremote-cert-tls "
        "server\nncp-ciphers AES-128-GCM:AES-128-CBC\nauth SHA256\n<ca>\n-----BEGIN CERTIFICATE-----\nYWJj\n-----END "
        "CERTIFICATE-----\n</ca>\n";
    test("profile regeneration", [&] {
        auto result = normalizeProfile(base);
        require(result.find("route-noexec\n") != std::string::npos &&
                    result.find("data-ciphers AES-128-GCM:AES-128-CBC") != std::string::npos &&
                    result.find("ncp-ciphers") == std::string::npos && result.find("persist-tun") == std::string::npos,
                "Unsafe profile output");
    });
    test("profile scripts/overrides rejected", [&] {
        rejects([&] { normalizeProfile(base + "up malicious.exe\n"); });
        rejects([&] { normalizeProfile(base + "remote attacker.test 443 tcp-client\n"); });
        rejects([&] { normalizeProfile(base + "config extra.ovpn\n"); });
        rejects([&] { normalizeProfile(base + "auth-user-pass passwords.txt\n"); });
    });
    test("profile malformed inline data rejected", [&] {
        rejects([&] { normalizeProfile(base + "<ca>\n"); });
        auto broken = base;
        broken.erase(broken.find("</ca>"));
        rejects([&] { normalizeProfile(broken); });
    });
    test("DNS valid A answer", [] {
        auto packet = dnsQuery("target.test", 0x1234);
        packet[2] = 0x81;
        packet[3] = 0x80;
        packet[7] = 1;
        const Bytes answer{0xc0, 0x0c, 0, 1, 0, 1, 0, 0, 0, 30, 0, 4, 10, 20, 30, 40};
        packet.insert(packet.end(), answer.begin(), answer.end());
        bool truncated = false;
        auto ips = dnsParse(packet, 0x1234, "target.test", truncated);
        require(!truncated && ips == std::vector<uint32_t>{0x0a141e28}, "DNS A parsing mismatch");
    });
    test("DNS ID/question/length rejected", [&] {
        auto packet = dnsQuery("target.test", 1);
        packet[2] = 0x81;
        packet[3] = 0x80;
        bool truncated = false;
        rejects([&] { dnsParse(packet, 2, "target.test", truncated); });
        rejects([&] { dnsParse(packet, 1, "other.test", truncated); });
        packet.resize(13);
        rejects([&] { dnsParse(packet, 1, "target.test", truncated); });
    });
    test("DNS truncation requests TCP", [] {
        auto packet = dnsQuery("target.test", 1);
        packet[2] = 0x83;
        packet[3] = 0x80;
        bool truncated = false;
        require(dnsParse(packet, 1, "target.test", truncated).empty() && truncated, "DNS TC flag ignored");
    });
    test("DNS compression loop rejected", [&] {
        auto packet = dnsQuery("target.test", 1);
        packet[2] = 0x81;
        packet[3] = 0x80;
        packet[12] = 0xc0;
        packet[13] = 0x0c;
        bool truncated = false;
        rejects([&] { dnsParse(packet, 1, "target.test", truncated); });
    });
    test("DNS unrelated answer rejected", [&] {
        auto packet = dnsQuery("target.test", 1);
        packet[2] = 0x81;
        packet[3] = 0x80;
        packet[7] = 1;
        Bytes rr{1, 'x', 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 4, 10, 0, 0, 1};
        packet.insert(packet.end(), rr.begin(), rr.end());
        bool truncated = false;
        rejects([&] { dnsParse(packet, 1, "target.test", truncated); });
    });
    test("DNS compressed CNAME chain", [] {
        auto packet = dnsQuery("target.test", 1);
        packet[2] = 0x81;
        packet[3] = 0x80;
        packet[7] = 2;
        Bytes cname{0xc0, 0x0c, 0, 5, 0, 1, 0, 0, 0, 30, 0, 10, 3, 'c', 'd', 'n', 4, 't', 'e', 's', 't', 0};
        size_t aliasOffset = packet.size() + 12;
        packet.insert(packet.end(), cname.begin(), cname.end());
        Bytes answer{0xc0, static_cast<unsigned char>(aliasOffset), 0, 1, 0, 1, 0, 0, 0, 30, 0, 4, 10, 0, 0, 7};
        packet.insert(packet.end(), answer.begin(), answer.end());
        bool truncated = false;
        require(dnsParse(packet, 1, "target.test", truncated) == std::vector<uint32_t>{0x0a000007},
                "CNAME resolution mismatch");
    });
    test("DNS CNAME cycle rejected", [&] {
        auto packet = dnsQuery("target.test", 1);
        packet[2] = 0x81;
        packet[3] = 0x80;
        packet[7] = 1;
        Bytes answer{0xc0, 0x0c, 0, 5, 0, 1, 0, 0, 0, 30, 0, 2, 0xc0, 0x0c};
        packet.insert(packet.end(), answer.begin(), answer.end());
        bool truncated = false;
        rejects([&] { dnsParse(packet, 1, "target.test", truncated); });
    });
    test("proxy short/incomplete headers rejected", [&] {
        rejects([] { parseConnect("abc"); });
        rejects([] { parseConnect("CONNECT target.test:443 HTTP/1.1\r\n"); });
    });
    test("proxy authentication encoding", [] {
        require(basic64("myneige:secret") == "bXluZWlnZTpzZWNyZXQ=" && constantEqual("abc", "abc") &&
                    !constantEqual("abc", "abd"),
                "Authentication encoding mismatch");
    });
    test("CONNECT header validation", [] {
        auto request = parseConnect(
            "CONNECT target.test:443 HTTP/1.1\r\nHost: target.test:443\r\nProxy-Authorization: Basic aaa\r\n\r\n");
        require(request.host == "target.test" && request.authorization == "Basic aaa", "CONNECT parse mismatch");
    });
    test("CONNECT smuggling rejected", [&] {
        rejects([] { parseConnect("CONNECT target.test:443 HTTP/1.1\r\nContent-Length: 1\r\n\r\n"); });
        rejects([] {
            parseConnect(
                "CONNECT target.test:443 HTTP/1.1\r\nProxy-Authorization: a\r\nProxy-Authorization: b\r\n\r\n");
        });
        rejects([] { parseConnect("CONNECT target.test:80 HTTP/1.1\r\n\r\n"); });
        rejects([] { parseConnect("GET https://target.test/ HTTP/1.1\r\n\r\n"); });
    });
    test("push metadata restricted extraction", [] {
        PushOptions push;
        push.observe(">LOG:0,,PUSH: Received control message: 'PUSH_REPLY,route-gateway 10.0.0.1,dhcp-option DNS "
                     "10.0.0.2,auth-token never-log-this'");
        require(push.gateway == 0x0a000001 && push.dns == std::vector<uint32_t>{0x0a000002}, "Push metadata mismatch");
    });
    test("push invalid DNS ignored", [] {
        PushOptions push;
        push.observe(">LOG:0,,PUSH_REPLY,dhcp-option DNS not-an-ip,route-gateway invalid'");
        require(push.dns.empty() && !push.gateway, "Invalid metadata admitted");
    });
    test("startup cipher advice is not an authentication failure", [] {
        require(!isCipherFailure(">LOG:0,I,Note: --cipher is not set. OpenVPN versions before 2.5 defaulted to BF-CBC "
                                 "as fallback when cipher negotiation failed in this case."),
                "Startup note misclassified");
        require(isCipherFailure(">LOG:0,,AUTH: Received control message: AUTH_FAILED,Data channel cipher negotiation "
                                "failed (no shared cipher)"),
                "Real negotiation failure not classified");
    });
    test("required encrypted DNS is not silently downgraded", [] {
        PushOptions push;
        push.observe(">LOG:0,,PUSH_REPLY,dns server 0 address 10.0.0.2,dns server 0 transport DoH'");
        require(push.unsupportedDnsPolicy, "Secure DNS requirement ignored");
        PushOptions port;
        port.observe(">LOG:0,,PUSH_REPLY,dns server 0 address 10.0.0.2:853'");
        require(port.unsupportedDnsPolicy, "DNS port requirement ignored");
    });
    test("diagnostics never reproduce server tokens or arbitrary states", [] {
        auto diagnostic = safeDiagnostic(">LOG:0,,AUTH_FAILED,opaque-secret-from-server");
        require(diagnostic == "AUTHENTICATION_OR_SERVER_POLICY_REJECTED" &&
                    diagnostic.find("secret") == std::string::npos,
                "Sensitive diagnostic reproduced");
        require(safeDiagnostic(">STATE:0,opaque-secret-from-server,reason").empty(), "Untrusted state logged");
        require(safeDiagnostic(">STATE:0,TCP_CONNECT,,192.0.2.1") == "STATE_TCP_CONNECT", "Known state not reported");
    });
    test("management hold and acknowledgements remain observable without secrets", [] {
        require(safeDiagnostic(">HOLD:Waiting for hold release:0") == "MANAGEMENT_WAITING_FOR_RELEASE",
                "Hold state lost");
        require(safeDiagnostic("SUCCESS: 'Auth' password entered, but not yet verified") ==
                    "MANAGEMENT_PASSWORD_ACCEPTED_LOCALLY",
                "Password acknowledgement lost");
        require(safeDiagnostic("ERROR: rejected opaque-secret") == "MANAGEMENT_COMMAND_REJECTED",
                "Unsafe command error");
    });
    test("management frames terminate with CRLF and reject extra commands", [&] {
        require(managementFrame("state on") == "state on\r\n", "Management line framing mismatch");
        rejects([] { managementFrame("state on\nsignal SIGTERM"); });
    });
    std::cout << passed << " protocol tests passed. No VPN, WFP or routing changes performed.\n";
    return 0;
}
} // namespace neige
