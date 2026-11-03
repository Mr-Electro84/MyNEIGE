#pragma once
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <bcrypt.h>
#include <algorithm>
#include <cctype>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <memory>
#include <sstream>
#include <stdexcept>
#include <string>
#include <vector>

// Utilitaires locaux : aucune API socket, WFP ou de lancement de processus.
namespace neige {
using Bytes = std::vector<unsigned char>;
inline void require(bool ok, const char *message) {
    if (!ok)
        throw std::runtime_error(message);
}
inline void wincheck(DWORD code, const char *operation) {
    if (code != ERROR_SUCCESS)
        throw std::runtime_error(std::string(operation) + " (Windows " + std::to_string(code) + ")");
}
struct Handle {
    HANDLE h = nullptr;
    Handle() = default;
    explicit Handle(HANDLE value) : h(value) {}
    Handle(const Handle &) = delete;
    Handle &operator=(const Handle &) = delete;
    Handle(Handle &&other) noexcept : h(other.h) {
        other.h = nullptr;
    }
    Handle &operator=(Handle &&other) noexcept {
        if (this != &other) {
            reset();
            h = other.h;
            other.h = nullptr;
        }
        return *this;
    }
    ~Handle() {
        reset();
    }
    void reset() {
        if (h && h != INVALID_HANDLE_VALUE)
            CloseHandle(h);
        h = nullptr;
    }
    HANDLE release() {
        HANDLE value = h;
        h = nullptr;
        return value;
    }
};
inline std::string utf8(const std::wstring &value) {
    if (value.empty())
        return {};
    int size = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr,
                                   0, nullptr, nullptr);
    require(size > 0, "Invalid Unicode");
    std::string result(size, '\0');
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(),
                        size, nullptr, nullptr);
    return result;
}
inline std::wstring wide(const std::string &value) {
    if (value.empty())
        return {};
    int size =
        MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
    require(size > 0, "Invalid UTF-8");
    std::wstring result(size, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(),
                        size);
    return result;
}
inline std::wstring imagePath() {
    std::wstring result(32768, L'\0');
    DWORD count = GetModuleFileNameW(nullptr, result.data(), static_cast<DWORD>(result.size()));
    require(count > 0 && count < result.size(), "Cannot locate executable");
    result.resize(count);
    return result;
}
inline std::vector<std::string> split(const std::string &value, char delimiter) {
    std::vector<std::string> result;
    std::istringstream stream(value);
    std::string item;
    while (std::getline(stream, item, delimiter))
        result.push_back(item);
    return result;
}
inline std::string lower(std::string value) {
    for (auto &c : value)
        c = static_cast<char>(tolower(static_cast<unsigned char>(c)));
    return value;
}
inline std::string trim(std::string value) {
    auto first = value.find_first_not_of(" \t\r\n");
    if (first == std::string::npos)
        return {};
    return value.substr(first, value.find_last_not_of(" \t\r\n") - first + 1);
}
inline std::string randomHex(size_t bytes = 32) {
    Bytes data(bytes);
    require(BCryptGenRandom(nullptr, data.data(), static_cast<ULONG>(data.size()), BCRYPT_USE_SYSTEM_PREFERRED_RNG) ==
                0,
            "Random source failed");
    static const char *hex = "0123456789abcdef";
    std::string result;
    result.reserve(bytes * 2);
    for (auto b : data) {
        result += hex[b >> 4];
        result += hex[b & 15];
    }
    return result;
}
inline void wipe(std::string &value) {
    if (!value.empty())
        SecureZeroMemory(value.data(), value.size());
    value.clear();
}
inline bool isAdministrator() {
    SID_IDENTIFIER_AUTHORITY authority = SECURITY_NT_AUTHORITY;
    PSID group = nullptr;
    BOOL member = FALSE;
    if (AllocateAndInitializeSid(&authority, 2, SECURITY_BUILTIN_DOMAIN_RID, DOMAIN_ALIAS_RID_ADMINS, 0, 0, 0, 0, 0, 0,
                                 &group)) {
        CheckTokenMembership(nullptr, group, &member);
        FreeSid(group);
    }
    return member != FALSE;
}
} // namespace neige
