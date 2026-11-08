#pragma once
#include "../shared/network.hpp"
#include "../shared/vpn-profile.hpp"
#include <fwpmu.h>
#include <sddl.h>
#include <conio.h>
#include <chrono>
#include <deque>
#include <functional>
namespace neige {
inline std::wstring quoteArgument(const std::wstring &value) {
    std::wstring output = L"\"";
    size_t slashes = 0;
    for (wchar_t c : value) {
        if (c == L'\\') {
            ++slashes;
            continue;
        }
        output.append(slashes * (c == L'\"' ? 2 : 1), L'\\');
        slashes = 0;
        if (c == L'\"')
            output += L'\\';
        output += c;
    }
    output.append(slashes * 2, L'\\');
    output += L'\"';
    return output;
}
inline void writePipe(HANDLE pipe, const std::string &text) {
    size_t offset = 0;
    while (offset < text.size()) {
        DWORD done = 0;
        require(WriteFile(pipe, text.data() + offset, static_cast<DWORD>(text.size() - offset), &done, nullptr) && done,
                "Control pipe write failed");
        offset += done;
    }
}
std::string managementQuote(const std::string &value);
std::string managementFrame(const std::string &value);
int selfTest();
} // namespace neige
