#include "worker-origin.hpp"
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
DWORD workerParentPid() {
    Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
    require(snapshot.h != INVALID_HANDLE_VALUE, "Cannot inspect creator process");
    PROCESSENTRY32W entry{sizeof(entry)};
    for (BOOL found = Process32FirstW(snapshot.h, &entry); found; found = Process32NextW(snapshot.h, &entry))
        if (entry.th32ProcessID == GetCurrentProcessId())
            return entry.th32ParentProcessID;
    throw std::runtime_error("Creator process unavailable");
}
void requirePrivilegedParent() {
    Handle parent(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, workerParentPid()));
    require(parent.h != nullptr, "Worker requires its privileged supervisor");
    auto token = processToken(parent.h, TOKEN_QUERY);
    auto integrity = tokenInfo(token.h, TokenIntegrityLevel);
    auto sid = reinterpret_cast<TOKEN_MANDATORY_LABEL *>(integrity.data())->Label.Sid;
    DWORD rid = *GetSidSubAuthority(sid, *GetSidSubAuthorityCount(sid) - 1);
    TOKEN_ELEVATION elevation{};
    DWORD size = sizeof(elevation);
    require(GetTokenInformation(token.h, TokenElevation, &elevation, size, &size) != 0 && elevation.TokenIsElevated &&
                rid >= SECURITY_MANDATORY_HIGH_RID,
            "Worker creator is not an elevated supervisor");
}
} // namespace neige
