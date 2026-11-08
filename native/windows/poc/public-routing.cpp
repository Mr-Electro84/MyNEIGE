#include "platform.hpp"

namespace neige {
std::string relayConfiguration(const Adapter &network, const std::vector<uint32_t> &dns, const std::string &host,
                               const std::string &token, const std::string &scope, uint16_t publicPort) {
    require(validHost(host) && token.size() == 64 && token.find_first_not_of("0123456789abcdef") == std::string::npos,
            "Invalid relay configuration identity");
    require(!dns.empty() && dns.size() <= 4 && network.name.find_first_of("\r\n") == std::string::npos &&
                network.guid.find_first_of("\r\n") == std::string::npos,
            "Invalid bound network configuration");
    require((scope == "public" && publicPort == 0 && publicServiceHost(host)) ||
                (scope == "university" && publicPort != 0 && universityHost(host)) ||
                (scope == "appigs" && publicPort == 0 && host == "www.appigs.univ-avignon.fr"),
            "Invalid relay scope or forwarding port");
    std::string configuration = (scope == "public" ? "MYNEIGE_PUBLIC_V1\n" : "MYNEIGE_RELAY_V4\n") +
        ipText(network.address) + "\n" + std::to_string(network.index) + "\n" + std::to_string(network.luid) + "\n" +
        network.guid + "\n" + network.name + "\n";
    for (size_t i = 0; i < dns.size(); ++i)
        configuration += (i ? "," : "") + ipText(dns[i]);
    return configuration + "\n" + host + "\n" + token + "\n" + scope + "\n" + std::to_string(publicPort) + "\n";
}
void PublicRelay::start(Job &job, Firewall &firewall, Staging &staging, const Adapter &network, const std::string &token) {
    require(!child.process.h && port == 0, "Public relay already started");
    firewall.allowPublicRelay(staging.publicExecutable.wstring(), network);
    child = job.spawn(staging.publicExecutable.wstring(), {}, true, true);
    auto configuration = relayConfiguration(network, network.dns, "partage.univ-avignon.fr", token, "public");
    writePipe(child.input.h, configuration); wipe(configuration);
    const auto fields = split(child.line(10000), ' ');
    require(fields.size() == 2 && fields[0] == "PUBLIC_READY", "Public relay did not become ready");
    const auto value = std::stoul(fields[1]);
    require(value > 0 && value <= 65535, "Invalid public relay listener");
    port = static_cast<uint16_t>(value);
}
void publicRelayChecks(Job &job, Firewall &firewall, Staging &staging) {
    // Les rôles ne sont pas négociables : même le superviseur ne peut les inverser.
    for (const auto &role : {std::make_pair(staging.executable, "MYNEIGE_PUBLIC_V1\n"),
                             std::make_pair(staging.publicExecutable, "MYNEIGE_RELAY_V4\n")}) {
        auto wrongRole = job.spawn(role.first.wstring(), {}, true, true);
        writePipe(wrongRole.input.h, role.second);
        require(wrongRole.line(5000) == "RELAY_ERROR", "Relay accepted another role's configuration");
        require(WaitForSingleObject(wrongRole.process.h, 5000) == WAIT_OBJECT_0, "Invalid relay stayed active");
        DWORD code = 0;
        require(GetExitCodeProcess(wrongRole.process.h, &code) && code == 1, "Invalid relay did not fail closed");
    }
    std::cout << "RELAY_ROLES_TEST wrong_role_refused=true restricted_workers=true" << std::endl;
    // Précontrôle local : aucun DNS distant ni service extérieur n'est appelé.
    auto network = adapterFor(0x7f000001);
    network.dns = {0x7f000001};
    auto token = randomHex();
    PublicRelay relay;
    relay.start(job, firewall, staging, network, token);
    const auto request = [&](const std::string &header) {
        Socket client(socket(AF_INET, SOCK_STREAM, IPPROTO_TCP));
        require(client.s != INVALID_SOCKET, "Cannot create public relay fixture client");
        connectWithin(client.s, endpoint(0x7f000001, relay.port));
        socketTimeout(client.s, 3000);
        sendText(client.s, header);
        return readHeader(client.s);
    };
    require(request("CONNECT www.youtube.com:443 HTTP/1.1\r\n\r\n").rfind("HTTP/1.1 407", 0) == 0,
            "Public relay accepted unauthenticated traffic");
    auto auth = "Basic " + basic64("myneige:" + token);
    for (const auto &host : {"cas.univ-avignon.fr", "idp.univ-avignon.fr", "cloud.univ-avignon.fr", "evil.test"}) {
        auto header = "CONNECT " + std::string(host) + ":443 HTTP/1.1\r\nProxy-Authorization: " + auth + "\r\n\r\n";
        const auto response = request(header); wipe(header);
        require(response.rfind("HTTP/1.1 403", 0) == 0, "Public relay accepted a protected or unknown domain");
    }
    wipe(auth); wipe(token); relay.child.stop();
    std::cout << "PUBLIC_RELAY_TEST authentication=true protected_refused=true unknown_refused=true no_remote_network=true" << std::endl;
}
} // namespace neige
