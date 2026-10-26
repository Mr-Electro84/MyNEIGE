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
    test("session de deux heures : avertissement unique cinq minutes avant la fin", [] {
        SessionLifetime session(1000, browserSessionSeconds);
        require(session.until == 7201000 && !session.warn(6900999), "Incorrect initial duration");
        require(session.warn(6901000) && session.remainingSeconds(6901000) == 300, "Warning missing");
        require(!session.warn(6902000) && !session.expired(7200999), "Duplicate or early expiration");
        require(session.expired(7201000) && session.remainingSeconds(7201000) == 0, "Expiration missing");
    });
    test("prolongation uniquement pendant l'avertissement et avant l'échéance", [] {
        SessionLifetime session(0, browserSessionSeconds);
        require(!session.extend(1000), "Unsolicited renewal accepted");
        require(session.warn(6900000) && session.extend(7199999), "Timely renewal refused");
        require(session.until == 14399999 && !session.warned, "Renewal did not reset two hours");
        require(!session.extend(7200000), "Duplicate renewal accepted");
        require(session.warn(14099999) && session.extend(14099999), "Second cycle cannot renew");
    });
    test("aucune prolongation ni avertissement après expiration ou réveil tardif", [] {
        SessionLifetime session(0, browserSessionSeconds);
        require(session.warn(6900000) && !session.extend(7200000), "Renewal at expiration accepted");
        require(!session.extend(9000000), "Expired session revived");
        SessionLifetime asleep(0, browserSessionSeconds);
        require(!asleep.warn(9000000) && asleep.expired(9000000), "Late wake revived the session");
    });
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
    test("browser scope admits RENATER and embedded learning dependencies only", [] {
        for (const auto &host : {"partage.univ-avignon.fr", "cloud.univ-avignon.fr", "sp.partage.renater.fr",
                                 "webmail.partage.renater.fr", "www.youtube.com", "www.youtube-nocookie.com",
                                 "rr1---sn-test.googlevideo.com", "i.ytimg.com", "youtubei.googleapis.com",
                                 "youtube.googleapis.com", "jnn-pa.googleapis.com", "yt3.ggpht.com",
                                 "www.gstatic.com", "fonts.gstatic.com", "www.google.com", "fonts.googleapis.com",
                                 "avignon.h5p.com", "eu-west-1.cdn.h5p.com", "h5p.org", "content.h5p.io",
                                 "cdnjs.cloudflare.com"})
            require(browserHost(host), "Missing browser dependency");
        for (const auto &host : {"evil.test", "evilyoutube.com", "youtube.com.evil.test", "renater.fr.evil.test",
                                 "evilrenater.fr", "127.0.0.1", "a..youtube.com", "google.com",
                                 "drive.google.com", "storage.googleapis.com", "youtube.com.", "h5p.com.evil.test"})
            require(!browserHost(host), "Browser dependency allowlist escaped");
    });
    test("routage public explicite et absence de repli pour les services protégés", [&] {
        for (const auto &host : {"partage.univ-avignon.fr", "sp.partage.renater.fr", "webmail.partage.renater.fr",
            "www.youtube.com", "www.youtube-nocookie.com", "rr1.googlevideo.com", "i.ytimg.com", "avignon.h5p.com",
            "cdn.jsdelivr.net", "cdnjs.cloudflare.com"})
            require(publicServiceHost(host) && browserHost(host), "Missing public service route");
        for (const auto &host : {"www.appigs.univ-avignon.fr", "cas.univ-avignon.fr", "idp.univ-avignon.fr",
            "ent.univ-avignon.fr", "cloud.univ-avignon.fr", "e-uapv2026.univ-avignon.fr", "evil.test",
            "partage.univ-avignon.fr.evil.test", "evilrenater.fr", "cdn.jsdelivr.net.evil.test"})
            require(!publicServiceHost(host), "Protected or unknown service escaped to the public network");
        const auto header = publicConnectHeader("www.youtube.com", "Basic local-fixture");
        const auto request = parseConnect(header);
        require(request.host == "www.youtube.com" && request.authorization == "Basic local-fixture", "Public proxy lost CONNECT identity");
        rejects([] { publicConnectHeader("cas.univ-avignon.fr", "Basic local-fixture"); });
        rejects([] { publicConnectHeader("www.youtube.com", "Basic x\r\nInjected: value"); });
    });
    test("la saturation publique ne consomme pas le quota VPN", [] {
        RelaySlots slots;
        for (unsigned i = 0; i < RelaySlots::limit; ++i) require(slots.acquire(true), "Public slot missing");
        require(!slots.acquire(true), "Public quota exceeded");
        for (unsigned i = 0; i < RelaySlots::limit; ++i) require(slots.acquire(false), "Public traffic exhausted VPN quota");
        require(!slots.acquire(false), "VPN quota exceeded");
        slots.release(true); require(slots.acquire(true), "Released slot unavailable");
        for (unsigned i = 0; i < RelaySlots::limit; ++i) { slots.release(true); slots.release(false); }
        require(slots.publicActive == 0 && slots.protectedActive == 0, "Relay quota leaked");
    });
    test("la sortie publique refuse les adresses locales, privées et réservées", [] {
        for (const auto &address : {"127.0.0.1", "10.40.0.1", "192.168.1.1", "172.16.0.1", "169.254.1.1",
            "100.64.1.1", "0.0.0.0", "224.0.0.1", "255.255.255.255", "198.18.0.1", "192.0.2.1"})
            require(!publicDestination(ipv4(address)), "Non-public destination escaped");
        require(publicDestination(ipv4("194.254.242.44")) && publicDestination(ipv4("142.251.154.4")),
                "Public target incorrectly refused");
    });
    test("les configurations des deux relais restent séparées et sans injection", [&] {
        Adapter network;
        network.name = "fixture"; network.guid = "fixture-guid";
        const std::string token(64, 'a');
        require(relayConfiguration(network, {0x01010101}, "partage.univ-avignon.fr", token, "public")
                    .rfind("MYNEIGE_PUBLIC_V1\n", 0) == 0, "Wrong public relay protocol");
        require(relayConfiguration(network, {0x01010101}, "www.appigs.univ-avignon.fr", token, "university", 12345)
                    .rfind("MYNEIGE_RELAY_V4\n", 0) == 0, "Wrong protected relay protocol");
        rejects([&] { relayConfiguration(network, {0x01010101}, "cas.univ-avignon.fr", token, "public"); });
        rejects([&] { relayConfiguration(network, {0x01010101}, "www.appigs.univ-avignon.fr", token, "university"); });
        rejects([&] { relayConfiguration(network, {}, "partage.univ-avignon.fr", token, "public"); });
        network.name = "injected\nvalue";
        rejects([&] { relayConfiguration(network, {0x01010101}, "partage.univ-avignon.fr", token, "public"); });
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
    test("relay diagnostics contain only validated generated metadata", [] {
        require(safeRelayDiagnostic("DNS_ATTEMPT_FAILED host=www.youtube.com stage=UDP_PARSE wsa=0 rcode=5 reason=RCODE"),
                "DNS diagnostic rejected");
        require(safeRelayDiagnostic("RELAY_REQUEST_FAILED host=partage.univ-avignon.fr stage=CONNECT wsa=10060") &&
                    safeRelayDiagnostic("RELAY_CAPACITY limit=16"), "Relay diagnostic rejected");
        for (const auto &line : {"RELAY_REQUEST_FAILED host=www.youtube.com/path?secret stage=DNS wsa=0",
             "RELAY_REQUEST_FAILED host=www.youtube.com stage=DNS wsa=0 token=secret",
             "DNS_ATTEMPT_FAILED host=www.youtube.com stage=UDP_PARSE wsa=0 rcode=0 reason=secret",
             "DNS_ATTEMPT_FAILED host=www.youtube.com stage=UDP_PARSE wsa=0 rcode=50 reason=RCODE"})
            require(!safeRelayDiagnostic(line), "Unsafe relay diagnostic accepted");
        require(browserRequestDiagnostic("UI_REQUEST_ERROR www.youtube.com subFrame ERR_TUNNEL_CONNECTION_FAILED") ==
                    "BROWSER_REQUEST_ERROR host=www.youtube.com type=subFrame error=ERR_TUNNEL_CONNECTION_FAILED",
                "Browser diagnostic rejected");
        require(browserRequestDiagnostic("UI_REQUEST_BLOCKED accounts.google.com subFrame") ==
                    "BROWSER_REQUEST_BLOCKED host=accounts.google.com type=subFrame", "Browser block diagnostic rejected");
        require(browserRequestDiagnostic("UI_MAIL_SSO RESPONSE https sp.partage.renater.fr POST 302") ==
                    "BROWSER_MAIL_SSO event=RESPONSE protocol=https host=sp.partage.renater.fr method=POST status=302",
                "Mail SSO diagnostic rejected");
        for (const auto &line : {"UI_REQUEST_ERROR www.youtube.com/path?secret subFrame ERR_FAILED",
             "UI_REQUEST_ERROR www.youtube.com subFrame secret", "UI_REQUEST_BLOCKED www.youtube.com secret",
             "UI_REQUEST_BLOCKED www.youtube.com subFrame token=secret",
             "UI_MAIL_SSO RESPONSE https sp.partage.renater.fr/path?ticket=secret POST 302",
             "UI_MAIL_SSO RESPONSE https sp.partage.renater.fr POST 99",
             "UI_MAIL_SSO RESPONSE https sp.partage.renater.fr POST 999",
             "UI_MAIL_SSO RESPONSE https sp.partage.renater.fr POST 302 token=secret",
             "UI_MAIL_SSO secret https sp.partage.renater.fr POST 302"})
            require(browserRequestDiagnostic(line).empty(), "Unsafe browser diagnostic accepted");
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
