#include "vault.hpp"

// Exécutable local distinct : aucun contrôleur, relais, socket ou gestionnaire WFP.
int wmain(int argc, wchar_t **argv) {
    try {
        std::cout << std::unitbuf;
        const auto command = argc == 2 ? neige::utf8(argv[1]) : "";
        if (command == "vault-capabilities") {
            std::cout << "MYNEIGE_VAULT_PROTOCOL=1\n";
            return 0;
        }
        if (command == "vault-worker") return neige::vaultWorker();
        if (command == "vault-self-test") return neige::vaultSelfTest();
        if (command == "vault-forget") return neige::vaultForget();
        std::cout << "VAULT_ERROR\n";
    } catch (...) {
        // Ne jamais reproduire de requête ou de donnée du coffre dans un diagnostic.
        std::cout << "VAULT_ERROR\n";
    }
    return 1;
}
