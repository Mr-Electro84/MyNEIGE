#include "session.hpp"

int wmain(int argc, wchar_t **argv) {
    try {
        neige::Winsock sockets;
        std::string command = argc > 1 ? neige::utf8(argv[1]) : "help";
        if (command == "self-test")
            return neige::selfTest();
        if (command == "relay-worker")
            return neige::relayWorker();
        if (command == "blocked-probe" || command == "blocked-probe-v6" || command == "bound-probe") {
            neige::require(argc == 3, "Missing probe port");
            auto port = std::stoul(argv[2]);
            neige::require(port > 0 && port <= 65535, "Invalid probe port");
            return neige::blockedProbe(static_cast<uint16_t>(port), command == "blocked-probe-v6",
                                       command == "bound-probe");
        }
        if (command == "wfp-test")
            return neige::wfpTest();
        if (command == "cleanup") {
            neige::require(neige::isAdministrator(), "cleanup requires an elevated console");
            auto mutex = neige::sessionMutex();
            neige::Firewall::recover();
            std::cout << "Owned WFP policy and inactive staging removed. No third-party rule was touched.\n";
            return 0;
        }
        neige::Options options;
        for (int i = 2; i < argc; ++i) {
            std::wstring key = argv[i];
            neige::require(i + 1 < argc, "Option value missing");
            std::wstring value = argv[++i];
            if (key == L"--profile")
                options.profile = value;
            else if (key == L"--openvpn")
                options.openvpn = value;
            else if (key == L"--dns") {
                neige::require(options.dns.size() < 4, "At most four VPN DNS servers");
                options.dns.push_back(neige::ipv4(neige::utf8(value)));
            } else if (key == L"--gateway")
                options.gateway = neige::ipv4(neige::utf8(value));
            else if (key == L"--seconds")
                options.seconds = static_cast<unsigned>(std::stoul(value));
            else
                throw std::runtime_error(
                    "Unknown option. Credentials are accepted only through the masked local console");
        }
        if (command == "inspect")
            return neige::inspect(options);
        if (command == "adapter-test")
            return neige::adapterTest(options);
        if (command == "auth-preflight") {
            options.authenticationProbe = true;
            return neige::connectSession(options);
        }
        if (command == "management-test") {
            options.localManagementTest = true;
            return neige::connectSession(options);
        }
        if (command == "connect")
            return neige::connectSession(options);
        std::cout << "MyNEIGE Windows network pilot\n\n"
                     "  myneige-poc self-test                 Protocol tests; no network changes\n"
                     "  myneige-poc inspect [--profile path]  Read-only prerequisites\n"
                     "  myneige-poc wfp-test                  Admin: local quarantine test\n"
                     "  myneige-poc adapter-test              Admin: create/quarantine/remove dedicated TAP\n"
                     "  myneige-poc auth-preflight            Admin: management handshake; no credentials\n"
                     "  myneige-poc management-test           Admin: synthetic credentials, loopback only\n"
                     "  myneige-poc connect [--openvpn path] [--profile path]\n"
                     "      [--dns verified-IPv4] [--gateway verified-IPv4] [--seconds 1..60]\n"
                     "  myneige-poc cleanup                   Admin: remove only owned stale WFP/staging\n\n"
                     "No GUI or packaging. No credentials on the command line.\n";
        return command == "help" ? 0 : 2;
    } catch (const std::exception &error) {
        std::cerr << "ERROR: " << error.what() << "\n";
        return 1;
    }
}
