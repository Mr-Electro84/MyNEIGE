#include "session.hpp"
#include "browser.hpp"
#include "startup.hpp"

int wmain(int argc, wchar_t **argv) {
    try {
        std::cout << std::unitbuf;
        std::string command = argc > 1 ? neige::utf8(argv[1]) : "help";
        if (command == "setup-capabilities") {
            std::cout << "MYNEIGE_SETUP_PROTOCOL=1\n";
            return 0;
        }
        if (command == "vault-worker")
            return neige::vaultWorker();
        if (command == "vault-self-test")
            return neige::vaultSelfTest();
        if (command == "vault-forget")
            return neige::vaultForget();
        if (command == "runtime-cache-probe") {
            neige::require(argc == 3, "Missing runtime cache probe path");
            return neige::runtimeCacheProbe(argv[2]);
        }
        neige::Winsock sockets;
        if (command == "self-test")
            return neige::selfTest();
        if (command == "relay-worker")
            return neige::relayWorker();
        if (command == "public-relay-worker")
            return neige::relayWorker(true);
        if (command == "security-probe")
            return neige::securityProbe();
        if (command == "privilege-test")
            return neige::privilegeTest();
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
        std::string logName;
        for (int i = 2; i < argc; ++i) {
            std::wstring key = argv[i];
            neige::require(i + 1 < argc, "Option value missing");
            std::wstring value = argv[++i];
            if (key == L"--profile")
                options.profile = value;
            else if (key == L"--openvpn")
                options.openvpn = value;
            else if (key == L"--project-root")
                options.projectRoot = value;
            else if (key == L"--log-name")
                logName = neige::utf8(value);
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
        if (command == "payload-check") {
            neige::validateDistribution(options.projectRoot);
            return 0;
        }
        if (command == "runtime-cache-test") {
            if (!logName.empty()) neige::openDistributionLog(logName);
            return neige::runtimeCacheTest(options.projectRoot);
        }
        if (command == "distribution-browse" || command == "distribution-test") {
            neige::openDistributionLog(logName);
            try {
                if (command == "distribution-test") return neige::browserTest(options.projectRoot);
                options.browserMode = true;
                options.seconds = neige::browserSessionSeconds;
                return neige::connectSession(options);
            } catch (const std::exception &error) {
                if (std::string(error.what()) == "Cancelled in browser") return 0;
                throw;
            }
        }
        if (command == "inspect")
            return neige::inspect(options);
        if (command == "openvpn-check") {
            neige::validateOpenVpn(options.openvpn);
            neige::validateOpenVpn(options.openvpn.parent_path() / L"tapctl.exe");
            std::cout << "OPENVPN_COMPATIBLE\n";
            return 0;
        }
        if (command == "browser-test")
            return neige::browserTest(options.projectRoot);
        if (command == "public-network-test")
            return neige::publicNetworkTest();
        if (command == "browse") {
            options.browserMode = true;
            options.seconds = neige::browserSessionSeconds;
            return neige::connectSession(options);
        }
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
        if (command == "qualify" || command == "qualify-crash") {
            options.qualification = true;
            options.crashAfterProbes = command == "qualify-crash";
            return neige::connectSession(options);
        }
        std::cout << "MyNEIGE Windows network pilot\n\n"
                     "  myneige-poc self-test                 Protocol tests; no network changes\n"
                     "  myneige-poc inspect [--profile path]  Read-only prerequisites\n"
                     "  myneige-poc wfp-test                  Admin: local quarantine test\n"
                     "  myneige-poc adapter-test              Admin: create/quarantine/remove dedicated TAP\n"
                     "  myneige-poc auth-preflight            Admin: management handshake; no credentials\n"
                     "  myneige-poc management-test           Admin: synthetic credentials, loopback only\n"
                     "  myneige-poc privilege-test            Admin: medium token and protected broker test\n"
                     "  myneige-poc browser-test --project-root path\n"
                     "      Admin: Electron quarantine, children, UDP and sandbox; no credentials\n"
                     "  myneige-poc browse --project-root path [--profile path]\n"
                     "      Admin broker, medium-integrity form and protected browser; renewable two-hour session\n"
                     "  myneige-poc qualify | qualify-crash [--profile path] [--seconds 1..60]\n"
                     "      Admin: real VPN, owned route loss; second command crashes broker with code 86\n"
                     "  myneige-poc connect [--openvpn path] [--profile path]\n"
                     "      [--dns verified-IPv4] [--gateway verified-IPv4] [--seconds 1..60]\n"
                     "  myneige-poc cleanup                   Admin: remove only owned stale WFP/staging\n\n"
                     "Credentials only in masked console or local form.\n";
        return command == "help" ? 0 : 2;
    } catch (const std::exception &error) {
        std::cerr << "ERROR: " << error.what() << "\n";
        return 1;
    } catch (...) {
        std::cerr << "ERROR: Manifeste ou appel Windows invalide\n";
        return 1;
    }
}
