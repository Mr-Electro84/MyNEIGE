#include "worker.hpp"

#if !defined(MYNEIGE_PUBLIC_RELAY) || (MYNEIGE_PUBLIC_RELAY != 0 && MYNEIGE_PUBLIC_RELAY != 1)
#error Le role du relais doit etre fixe a la compilation.
#endif

int wmain(int argc, wchar_t **argv) {
    try {
        std::cout << std::unitbuf;
        if (argc == 2 && std::wstring(argv[1]) == L"--capabilities") {
            std::cout << "MYNEIGE_RELAY_PROTOCOL=1\nMYNEIGE_RELAY_ROLE="
                      << (MYNEIGE_PUBLIC_RELAY ? "public" : "vpn") << "\n";
            return 0;
        }
        // Aucun argument ne peut changer le rôle ou désigner un programme à lancer.
        if (argc != 1) return 2;
        neige::Winsock sockets;
        return neige::relayWorker();
    } catch (...) {
        // Ne pas refléter les données du pipe ni un secret dans les diagnostics.
        std::cerr << "RELAY_ERROR\n";
        return 1;
    }
}
