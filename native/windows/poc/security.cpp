#include "platform.hpp"
#include <aclapi.h>
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
void protectSupervisor() {
    require(isAdministrator(), "Supervisor protection requires administrator rights");
    // A worker may query provenance, but cannot inject, duplicate handles or terminate the broker.
    auto sddl = L"O:BAD:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;0x00101000;;;" + currentUserSid() + L")S:(ML;;NW;;;HI)";
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    require(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr) !=
                0,
            "Cannot build supervisor ACL");
    std::unique_ptr<void, decltype(&LocalFree)> cleanup(descriptor, LocalFree);
    PACL acl = nullptr;
    BOOL present = FALSE, defaulted = FALSE;
    require(GetSecurityDescriptorDacl(descriptor, &present, &acl, &defaulted) && present, "Cannot read supervisor ACL");
    PACL label = nullptr;
    PSID owner = nullptr;
    require(GetSecurityDescriptorSacl(descriptor, &present, &label, &defaulted) && present &&
                GetSecurityDescriptorOwner(descriptor, &owner, &defaulted),
            "Cannot read supervisor label/owner");
    wincheck(SetSecurityInfo(GetCurrentProcess(), SE_KERNEL_OBJECT,
                             OWNER_SECURITY_INFORMATION | LABEL_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION |
                                 PROTECTED_DACL_SECURITY_INFORMATION,
                             owner, nullptr, acl, label),
             "Protect supervisor process");
}
std::wstring currentUserSid() {
    auto token = processToken(GetCurrentProcess(), TOKEN_QUERY);
    auto data = tokenInfo(token.h, TokenUser);
    LPWSTR text = nullptr;
    require(ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER *>(data.data())->User.Sid, &text) != 0,
            "Cannot encode user SID");
    std::wstring result(text);
    LocalFree(text);
    return result;
}
Handle restrictedToken() {
    auto own =
        processToken(GetCurrentProcess(), TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT);
    BYTE admin[SECURITY_MAX_SID_SIZE]{};
    DWORD size = sizeof(admin);
    require(CreateWellKnownSid(WinBuiltinAdministratorsSid, nullptr, admin, &size) != 0, "Cannot build admin SID");
    SID_AND_ATTRIBUTES disabled{admin, 0};
    HANDLE raw = nullptr;
    require(CreateRestrictedToken(own.h, DISABLE_MAX_PRIVILEGE, 1, &disabled, 0, nullptr, 0, nullptr, &raw) != 0,
            "Cannot create non-administrative token");
    Handle token(raw);
    PSID medium = nullptr;
    require(ConvertStringSidToSidW(L"S-1-16-8192", &medium) != 0, "Cannot build medium integrity SID");
    std::unique_ptr<void, decltype(&LocalFree)> freeMedium(medium, LocalFree);
    TOKEN_MANDATORY_LABEL label{{medium, SE_GROUP_INTEGRITY}};
    if (!SetTokenInformation(token.h, TokenIntegrityLevel, &label,
                             static_cast<DWORD>(sizeof(label) + GetLengthSid(medium))))
        wincheck(GetLastError(), "Cannot lower child integrity level");
    auto sddl = L"D:(A;;GA;;;SY)(A;;GA;;;" + currentUserSid() + L")";
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    require(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr) !=
                0,
            "Cannot create unprivileged token default ACL");
    std::unique_ptr<void, decltype(&LocalFree)> freeDescriptor(descriptor, LocalFree);
    BOOL present = FALSE, defaulted = FALSE;
    PACL acl = nullptr;
    require(GetSecurityDescriptorDacl(descriptor, &present, &acl, &defaulted) && present,
            "Cannot read token default ACL");
    TOKEN_DEFAULT_DACL defaultDacl{acl};
    require(SetTokenInformation(token.h, TokenDefaultDacl, &defaultDacl, sizeof(defaultDacl)) != 0,
            "Cannot assign unprivileged default ACL");
    return token;
}
void grantUserRead(const std::filesystem::path &path) {
    // Owner and writable ACEs remain administrative; the session user gets only read/execute.
    auto sddl = L"O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FRFX;;;" + currentUserSid() + L")";
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    require(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr) !=
                0,
            "Cannot create read-only session ACL");
    std::unique_ptr<void, decltype(&LocalFree)> cleanup(descriptor, LocalFree);
    require(SetFileSecurityW(path.c_str(),
                             OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION | DACL_SECURITY_INFORMATION |
                                 PROTECTED_DACL_SECURITY_INFORMATION,
                             descriptor) != 0,
            "Cannot grant read-only session access");
}
static DWORD parentPid() {
    Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
    require(snapshot.h != INVALID_HANDLE_VALUE, "Cannot inspect creator process");
    PROCESSENTRY32W entry{sizeof(entry)};
    for (BOOL found = Process32FirstW(snapshot.h, &entry); found; found = Process32NextW(snapshot.h, &entry))
        if (entry.th32ProcessID == GetCurrentProcessId())
            return entry.th32ParentProcessID;
    throw std::runtime_error("Creator process unavailable");
}
void requirePrivilegedParent() {
    Handle parent(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, parentPid()));
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
    Handle parentWrite(OpenProcess(PROCESS_TERMINATE, FALSE, parentPid()));
    require(parentWrite.h == nullptr, "Worker can terminate its privileged supervisor");
    std::cout << "SECURITY_PROBE medium_integrity=true admin=false image_writable=false supervisor_terminable=false"
              << std::endl;
    return 0;
}
int privilegeTest() {
    require(isAdministrator(), "privilege-test requires an elevated console");
    protectSupervisor();
    Staging stage;
    stage.allowUserRead();
    Job job;
    auto child = job.spawn(stage.executable.wstring(), {L"security-probe"}, true, true);
    auto result = child.line(10000);
    if (result.rfind("ERROR: ", 0) == 0)
        std::cout << "SECURITY_PROBE_FAILURE " << result << std::endl;
    require(result ==
                "SECURITY_PROBE medium_integrity=true admin=false image_writable=false supervisor_terminable=false",
            "Non-administrative worker security probe failed");
    std::cout << "RESULT {\"restricted_worker\":true,\"integrity\":\"medium\",\"admin\":false,\"image_protected\":true}"
              << std::endl;
    return 0;
}
} // namespace neige
