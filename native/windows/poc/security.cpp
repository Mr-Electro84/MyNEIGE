#include "platform.hpp"
#include <aclapi.h>
#include <tlhelp32.h>
#include <shlobj.h>

namespace neige {
static Handle interactiveToken;
static std::wstring interactiveSid;
static bool useInteractiveToken = false;
std::filesystem::path interactiveLocalAppData() {
    PWSTR folder = nullptr;
    require(SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, KF_FLAG_DEFAULT, interactiveToken.h, &folder)),
            "Cannot locate interactive user data directory");
    std::filesystem::path result(folder);
    CoTaskMemFree(folder);
    return result;
}
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
    if (!interactiveSid.empty())
        return interactiveSid;
    auto token = processToken(GetCurrentProcess(), TOKEN_QUERY);
    auto data = tokenInfo(token.h, TokenUser);
    LPWSTR text = nullptr;
    require(ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER *>(data.data())->User.Sid, &text) != 0,
            "Cannot encode user SID");
    std::wstring result(text);
    LocalFree(text);
    return result;
}
void selectInteractiveUser() {
    // The shell belongs to the interactive desktop, even if UAC used another
    // administrator. Never persist the elevated administrator's credentials.
    DWORD pid = 0, ownSession = 0, shellSession = 0;
    HWND shell = GetShellWindow();
    require(shell && GetWindowThreadProcessId(shell, &pid), "Interactive desktop user unavailable");
    require(ProcessIdToSessionId(GetCurrentProcessId(), &ownSession) && ProcessIdToSessionId(pid, &shellSession) &&
                ownSession == shellSession,
            "Interactive user belongs to another Windows session");
    Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid));
    require(process.h != nullptr, "Cannot inspect interactive shell");
    auto token = processToken(process.h, TOKEN_QUERY | TOKEN_DUPLICATE);
    HANDLE copy = nullptr;
    require(DuplicateTokenEx(token.h, TOKEN_ALL_ACCESS, nullptr, SecurityImpersonation, TokenPrimary, &copy),
            "Cannot retain interactive user token");
    const auto brokerSid = currentUserSid();
    interactiveToken = Handle(copy);
    auto data = tokenInfo(copy, TokenUser);
    LPWSTR sid = nullptr;
    require(ConvertSidToStringSidW(reinterpret_cast<TOKEN_USER *>(data.data())->User.Sid, &sid),
            "Cannot identify interactive user");
    interactiveSid = sid;
    LocalFree(sid);
    useInteractiveToken = interactiveSid != brokerSid;
}
Handle restrictedToken() {
    auto own =
        processToken(GetCurrentProcess(), TOKEN_DUPLICATE | TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_ADJUST_DEFAULT);
    BYTE admin[SECURITY_MAX_SID_SIZE]{};
    DWORD size = sizeof(admin);
    require(CreateWellKnownSid(WinBuiltinAdministratorsSid, nullptr, admin, &size) != 0, "Cannot build admin SID");
    SID_AND_ATTRIBUTES disabled{admin, 0};
    HANDLE raw = nullptr;
    require(CreateRestrictedToken(useInteractiveToken ? interactiveToken.h : own.h, DISABLE_MAX_PRIVILEGE, 1, &disabled,
                                  0, nullptr, 0, nullptr, &raw) != 0,
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
int privilegeTest() {
    require(isAdministrator(), "privilege-test requires an elevated console");
    protectSupervisor();
    Staging stage;
    stage.allowUserRead();
    Job job;
    auto child = job.spawn(stage.diagnostic().wstring(), {L"security-probe"}, true, true);
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
