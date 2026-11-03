#pragma once
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <iphlpapi.h>
#include <netioapi.h>
#include <fwpmu.h>
#include <bcrypt.h>
#include <sddl.h>
#include <conio.h>
#include <algorithm>
#include <array>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <deque>
#include <filesystem>
#include <fstream>
#include <functional>
#include <iostream>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <sstream>
#include <syncstream>
#include <stdexcept>
#include <string>
#include <thread>
#include <vector>
#include "../shared/core.hpp"
#include "../shared/vpn-profile.hpp"

namespace neige {
struct Socket {
    SOCKET s = INVALID_SOCKET;
    Socket() = default;
    explicit Socket(SOCKET value) : s(value) {}
    Socket(const Socket &) = delete;
    Socket &operator=(const Socket &) = delete;
    Socket(Socket &&other) noexcept : s(other.s) {
        other.s = INVALID_SOCKET;
    }
    Socket &operator=(Socket &&other) noexcept {
        if (this != &other) {
            reset();
            s = other.s;
            other.s = INVALID_SOCKET;
        }
        return *this;
    }
    ~Socket() {
        reset();
    }
    void reset() {
        if (s != INVALID_SOCKET)
            closesocket(s);
        s = INVALID_SOCKET;
    }
    SOCKET release() {
        auto value = s;
        s = INVALID_SOCKET;
        return value;
    }
};
struct Winsock {
    Winsock() {
        WSADATA data{};
        require(WSAStartup(MAKEWORD(2, 2), &data) == 0, "WSAStartup failed");
    }
    ~Winsock() {
        WSACleanup();
    }
};
inline uint32_t ipv4(const std::string &text) {
    IN_ADDR address{};
    require(InetPtonA(AF_INET, text.c_str(), &address) == 1, "Expected a literal IPv4 address");
    return ntohl(address.S_un.S_addr);
}
inline std::string ipText(uint32_t hostOrder) {
    IN_ADDR address{};
    address.S_un.S_addr = htonl(hostOrder);
    char buffer[INET_ADDRSTRLEN]{};
    require(InetNtopA(AF_INET, &address, buffer, sizeof(buffer)) != nullptr, "Cannot format address");
    return buffer;
}
inline sockaddr_in endpoint(uint32_t address, uint16_t port) {
    sockaddr_in result{};
    result.sin_family = AF_INET;
    result.sin_port = htons(port);
    result.sin_addr.S_un.S_addr = htonl(address);
    return result;
}
inline void sendAll(SOCKET socket, const void *input, size_t length) {
    auto data = static_cast<const char *>(input);
    while (length) {
        int sent = send(socket, data, static_cast<int>(std::min<size_t>(length, 65536)), 0);
        require(sent > 0, "Socket write failed");
        data += sent;
        length -= sent;
    }
}
inline void sendText(SOCKET socket, const std::string &text) {
    sendAll(socket, text.data(), text.size());
}
inline void recvAll(SOCKET socket, void *output, size_t length) {
    auto data = static_cast<char *>(output);
    while (length) {
        int got = recv(socket, data, static_cast<int>(length), 0);
        require(got > 0, "Socket read failed");
        data += got;
        length -= got;
    }
}
inline void socketTimeout(SOCKET socket, DWORD ms) {
    require(setsockopt(socket, SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char *>(&ms), sizeof(ms)) == 0,
            "Cannot set receive timeout");
    require(setsockopt(socket, SOL_SOCKET, SO_SNDTIMEO, reinterpret_cast<const char *>(&ms), sizeof(ms)) == 0,
            "Cannot set send timeout");
}
inline bool readable(SOCKET socket, long milliseconds) {
    fd_set set;
    FD_ZERO(&set);
    FD_SET(socket, &set);
    timeval timeout{milliseconds / 1000, (milliseconds % 1000) * 1000};
    int result = select(0, &set, nullptr, nullptr, &timeout);
    require(result >= 0, "Socket select failed");
    return result > 0;
}
inline void connectWithinAddress(SOCKET socket, const sockaddr *address, int addressLength, long milliseconds = 10000) {
    u_long nonblocking = 1;
    require(ioctlsocket(socket, FIONBIO, &nonblocking) == 0, "Cannot configure socket");
    int status = connect(socket, address, addressLength);
    if (status == SOCKET_ERROR) {
        int initialError = WSAGetLastError();
        if (initialError != WSAEWOULDBLOCK) {
            WSASetLastError(initialError);
            throw std::runtime_error("Connection rejected (Winsock " + std::to_string(initialError) + ")");
        }
        fd_set writes, errors;
        FD_ZERO(&writes);
        FD_ZERO(&errors);
        FD_SET(socket, &writes);
        FD_SET(socket, &errors);
        timeval wait{milliseconds / 1000, (milliseconds % 1000) * 1000};
        require(select(0, nullptr, &writes, &errors, &wait) > 0, "Connection timed out");
        int error = 0, length = sizeof(error);
        require(getsockopt(socket, SOL_SOCKET, SO_ERROR, reinterpret_cast<char *>(&error), &length) == 0,
                "Cannot inspect connection result");
        if (error) {
            WSASetLastError(error);
            throw std::runtime_error("Connection rejected (Winsock " + std::to_string(error) + ")");
        }
    }
    nonblocking = 0;
    require(ioctlsocket(socket, FIONBIO, &nonblocking) == 0, "Cannot restore blocking socket");
}
inline void connectWithin(SOCKET socket, const sockaddr_in &address, long milliseconds = 10000) {
    connectWithinAddress(socket, reinterpret_cast<const sockaddr *>(&address), sizeof(address), milliseconds);
}
inline Socket loopbackListener(uint16_t &port) {
    Socket result(socket(AF_INET, SOCK_STREAM, IPPROTO_TCP));
    require(result.s != INVALID_SOCKET, "Cannot create listener");
    BOOL exclusive = TRUE;
    require(setsockopt(result.s, SOL_SOCKET, SO_EXCLUSIVEADDRUSE, reinterpret_cast<const char *>(&exclusive),
                       sizeof(exclusive)) == 0,
            "Cannot reserve exclusive port");
    auto address = endpoint(0x7f000001, 0);
    require(bind(result.s, reinterpret_cast<sockaddr *>(&address), sizeof(address)) == 0, "Cannot bind loopback");
    require(listen(result.s, 8) == 0, "Cannot listen");
    int length = sizeof(address);
    require(getsockname(result.s, reinterpret_cast<sockaddr *>(&address), &length) == 0, "Cannot read port");
    port = ntohs(address.sin_port);
    return result;
}
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
inline std::string readHeader(SOCKET client) {
    std::string result;
    const auto deadline = GetTickCount64() + 5000;
    while (result.size() < 16384) {
        require(GetTickCount64() < deadline, "Proxy header timeout");
        char c = 0;
        require(recv(client, &c, 1, 0) == 1, "Incomplete proxy header");
        result += c;
        if (result.size() >= 4 && result.compare(result.size() - 4, 4, "\r\n\r\n") == 0)
            return result;
    }
    throw std::runtime_error("Proxy header limit exceeded");
}
std::string managementFrame(const std::string &value);
std::vector<uint32_t> dnsParse(const Bytes &packet, uint16_t id, const std::string &name, bool &truncated);
Bytes dnsQuery(const std::string &name, uint16_t id);
std::string basic64(const std::string &text);
bool constantEqual(const std::string &a, const std::string &b);
bool universityHost(const std::string &host);
bool browserHost(const std::string &host);
bool publicServiceHost(const std::string &host);
bool publicDestination(uint32_t address);
struct RelaySlots {
    static constexpr unsigned limit = 32;
    std::atomic<unsigned> publicActive{0}, protectedActive{0};
    bool acquire(bool publicRoute) {
        auto &counter = publicRoute ? publicActive : protectedActive;
        if (counter.fetch_add(1) < limit) return true;
        --counter; return false;
    }
    void release(bool publicRoute) noexcept { --(publicRoute ? publicActive : protectedActive); }
};
std::string publicConnectHeader(const std::string &host, const std::string &authorization);
bool safeRelayDiagnostic(const std::string &line);
std::string browserRequestDiagnostic(const std::string &line);
struct ConnectRequest {
    std::string host;
    std::string authorization;
    uint16_t port = 443;
};
ConnectRequest parseConnect(const std::string &header, bool allowSsh = false);
std::string sshProxyAuthorization(const std::string &token);
bool authorizedConnect(const ConnectRequest &request, const std::string &web, const std::string &ssh);
int selfTest();
} // namespace neige
