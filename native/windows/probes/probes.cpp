#include "../shared/network-platform.hpp"
#include "../shared/worker-origin.hpp"
#include "../shared/hash.hpp"
#include <tlhelp32.h>
namespace neige {
static Handle processToken(HANDLE process, DWORD access) {
    HANDLE raw = nullptr;
    require(OpenProcessToken(process, access, &raw) != 0, "Cannot open process token");
    return Handle(raw);
}
static Bytes tokenInfo(HANDLE token, TOKEN_INFORMATION_CLASS kind) {
    DWORD size = 0;
    GetTokenInformation(token, kind, nullptr, 0, &size);
    require(size > 0, "Cannot size token information");
    Bytes result(size);
    require(GetTokenInformation(token, kind, result.data(), size, &size) != 0, "Cannot inspect process token");
    return result;
}
int securityProbe() {
    requirePrivilegedParent();
    require(!isAdministrator(), "Worker unexpectedly retains administrator membership");
    auto token = processToken(GetCurrentProcess(), TOKEN_QUERY);
    auto integrity = tokenInfo(token.h, TokenIntegrityLevel);
    auto sid = reinterpret_cast<TOKEN_MANDATORY_LABEL *>(integrity.data())->Label.Sid;
    DWORD rid = *GetSidSubAuthority(sid, *GetSidSubAuthorityCount(sid) - 1);
    require(rid == SECURITY_MANDATORY_MEDIUM_RID, "Worker must have medium integrity");
    Handle write(CreateFileW(imagePath().c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr));
    require(write.h == INVALID_HANDLE_VALUE, "Worker can modify its protected image");
    Handle parentWrite(OpenProcess(PROCESS_TERMINATE, FALSE, workerParentPid()));
    require(parentWrite.h == nullptr, "Worker can terminate its privileged supervisor");
    std::cout << "SECURITY_PROBE medium_integrity=true admin=false image_writable=false supervisor_terminable=false"
              << std::endl;
    return 0;
}
int runtimeCacheProbe(const std::filesystem::path &path) {
    requirePrivilegedParent();
    require(!isAdministrator(), "Runtime cache probe must not be elevated");
    require(sha256File(path) == sha256Text("abc"), "Unprivileged runtime read failed");
    Handle writable(CreateFileW(path.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, OPEN_EXISTING, 0, nullptr));
    require(writable.h == INVALID_HANDLE_VALUE && GetLastError() == ERROR_ACCESS_DENIED,
            "Unprivileged process can write runtime cache");
    std::cout << "CACHE_READ_ONLY" << std::endl;
    return 0;
}
int blockedProbe(uint16_t port, bool ipv6, bool bound) {
    Socket socket = bound ? vpnSocket(adapterFor(0x7f000001), SOCK_STREAM, IPPROTO_TCP)
                          : Socket(::socket(ipv6 ? AF_INET6 : AF_INET, SOCK_STREAM, IPPROTO_TCP));
    require(socket.s != INVALID_SOCKET, "Cannot create quarantine probe");
    try {
        if (ipv6) {
            sockaddr_in6 address{};
            address.sin6_family = AF_INET6;
            address.sin6_addr = in6addr_loopback;
            address.sin6_port = htons(port);
            connectWithinAddress(socket.s, reinterpret_cast<sockaddr *>(&address), sizeof(address), 2000);
        } else
            connectWithin(socket.s, endpoint(0x7f000001, port), 2000);
        std::cout << "UNEXPECTED_CONNECT" << std::endl;
        return 4;
    } catch (const std::exception &) {
        int code = WSAGetLastError();
        std::cout << "BLOCK_RESULT " << code << std::endl;
        return code == WSAEACCES ? 0 : 5;
    }
}
} // namespace neige
