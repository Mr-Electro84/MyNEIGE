#include "../shared/network-platform.hpp"
#include "../shared/worker-origin.hpp"
namespace neige {
int blockedProbe(uint16_t port, bool ipv6 = false, bool bound = false);
int securityProbe();
int runtimeCacheProbe(const std::filesystem::path &path);
}

// Outil de recette local : jamais copié dans un paquet distribuable.
int wmain(int argc, wchar_t **argv) {
    try {
        neige::requirePrivilegedParent();
        if (argc == 2 && std::wstring(argv[1]) == L"security-probe") return neige::securityProbe();
        if (argc == 3 && std::wstring(argv[1]) == L"runtime-cache-probe") return neige::runtimeCacheProbe(argv[2]);
        if (argc == 3) {
            const std::wstring command = argv[1];
            const auto port = std::stoul(argv[2]);
            neige::require(port > 0 && port <= 65535, "Invalid probe port");
            neige::Winsock sockets;
            if (command == L"blocked-probe" || command == L"blocked-probe-v6" || command == L"bound-probe")
                return neige::blockedProbe(static_cast<uint16_t>(port), command == L"blocked-probe-v6", command == L"bound-probe");
        }
        return 2;
    } catch (...) {
        std::cerr << "PROBE_ERROR\n";
        return 1;
    }
}
