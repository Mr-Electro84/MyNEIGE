#pragma once
#include <cstdint>

namespace neige {
inline constexpr unsigned browserSessionSeconds = 2 * 60 * 60;

// Le contrôleur reste seul maître du délai ; aucune horloge du navigateur
// ni activité d'une page universitaire ne peut prolonger la session.
struct SessionLifetime {
    uint64_t until;
    bool warned = false;
    SessionLifetime(uint64_t now, unsigned seconds) : until(now + seconds * 1000ULL) {}
    bool expired(uint64_t now) const { return now >= until; }
    bool warn(uint64_t now) {
        if (warned || expired(now) || until - now > 300000ULL) return false;
        warned = true;
        return true;
    }
    unsigned remainingSeconds(uint64_t now) const {
        return expired(now) ? 0 : static_cast<unsigned>((until - now + 999) / 1000);
    }
    bool extend(uint64_t now) {
        if (!warned || expired(now)) return false;
        until = now + browserSessionSeconds * 1000ULL;
        warned = false;
        return true;
    }
};
} // namespace neige
