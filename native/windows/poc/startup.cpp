#include "startup.hpp"
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <limits>
#include <shlobj.h>
#include <aclapi.h>
#include <io.h>
#include <fcntl.h>

namespace neige {
void assertPlainTree(const std::filesystem::path &root) {
    DWORD attributes = GetFileAttributesW(root.c_str());
    require(attributes != INVALID_FILE_ATTRIBUTES && !(attributes & FILE_ATTRIBUTE_REPARSE_POINT),
            "Lien ou repertoire redirige refuse");
    if (attributes & FILE_ATTRIBUTE_DIRECTORY)
        for (const auto &entry : std::filesystem::directory_iterator(root))
            assertPlainTree(entry.path());
}
static winrt::Windows::Data::Json::JsonObject readJson(const std::filesystem::path &file) {
    require(std::filesystem::file_size(file) < 4 * 1024 * 1024, "Manifeste trop volumineux");
    std::ifstream input(file, std::ios::binary);
    require(bool(input), "Manifeste ou metadonnees manquants");
    std::string text((std::istreambuf_iterator<char>(input)), std::istreambuf_iterator<char>());
    require(text.size() < 4 * 1024 * 1024, "Manifeste trop volumineux");
    if (text.starts_with("\xEF\xBB\xBF")) text.erase(0, 3);
    return winrt::Windows::Data::Json::JsonObject::Parse(winrt::hstring(wide(text)));
}
void validateDistribution(const std::filesystem::path &root) {
    // Check all descendants too: an unlisted reparse point must not be accepted.
    assertPlainTree(root);
    for (const auto &entry : std::filesystem::recursive_directory_iterator(root)) {
        auto extension = lower(utf8(entry.path().extension().wstring()));
        require(extension != ".ovpn" && extension != ".dpapi", "Profil personnel interdit dans le paquet");
    }
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
    auto manifest = readJson(root / L"distribution.json");
    require(manifest.GetNamedString(L"product") == L"MyNEIGE" && manifest.GetNamedNumber(L"schema") == 1 &&
                manifest.GetNamedString(L"architecture") == L"x64", "Manifeste de distribution incompatible");
    auto files = manifest.GetNamedArray(L"files");
    require(files.Size() > 0, "Manifeste de distribution vide");
    std::set<std::wstring> seen;
    for (const auto &value : files) {
        auto entry = value.GetObject();
        std::wstring name(entry.GetNamedString(L"path"));
        require(!name.empty() && name.find_first_of(L"\\:") == std::wstring::npos && name.front() != L'/',
                "Chemin de paquet invalide");
        for (const auto &part : std::filesystem::path(name)) {
            auto component = part.wstring();
            require(!component.empty() && component.back() != L'.' && component.back() != L' ',
                    "Chemin de paquet invalide");
        }
        // Windows path aliases must not turn two manifest entries into one file.
        require(name.back() != L'/' && name.find(L"//") == std::wstring::npos, "Chemin de paquet invalide");
        auto folded = name;
        for (auto &c : folded) c = static_cast<wchar_t>(towlower(c));
        require(seen.insert(folded).second, "Entree de manifeste invalide ou dupliquee");
        std::string expected = utf8(std::wstring(entry.GetNamedString(L"sha256")));
        require(expected.size() == 64 && expected.find_first_not_of("0123456789ABCDEFabcdef") == std::string::npos,
                "Empreinte de manifeste invalide");
        require(lower(sha256File(root / name)) == lower(expected), "Fichier du programme manquant ou altere");
    }
    for (const auto *required : {L"myneige.exe", L"bin/myneige-controller.exe", L"bin/myneige-vault.exe", L"resources/runtime/electron.exe",
             L"src/main/index.js", L"src/main/about.js", L"package.json", L"license",
             L"scripts/launch-distribution.ps1", L"scripts/run-distribution-worker.ps1", L"scripts/openvpn-setup.ps1"})
        require(seen.count(required) != 0, "Fichier obligatoire absent du manifeste");
    require(readJson(root / L"package.json").GetNamedString(L"version") == manifest.GetNamedString(L"version"),
            "Versions du manifeste et du programme incoherentes");
    std::cout << "PAYLOAD_VALIDATED files=" << files.Size() << std::endl;
}
std::vector<RuntimeFile> runtimeManifest(const std::filesystem::path &source) {
    auto root = source.parent_path().parent_path();
    if (source.filename() != L"runtime" || source.parent_path().filename() != L"resources" ||
        !std::filesystem::exists(root / L"distribution.json")) return {};
    winrt::init_apartment(winrt::apartment_type::multi_threaded);
    auto manifest = readJson(root / L"distribution.json");
    require(manifest.GetNamedString(L"product") == L"MyNEIGE" && manifest.GetNamedNumber(L"schema") == 1,
            "Invalid runtime manifest");
    std::vector<RuntimeFile> files;
    std::set<std::wstring> names;
    for (const auto &value : manifest.GetNamedArray(L"files")) {
        auto entry = value.GetObject();
        std::wstring name(entry.GetNamedString(L"path"));
        if (!name.starts_with(L"resources/runtime/")) continue;
        name.erase(0, 18);
        require(!name.empty() && name.front() != L'/' && name.back() != L'/' &&
                    name.find_first_of(L"\\:") == std::wstring::npos && name.find(L"//") == std::wstring::npos,
                "Invalid runtime manifest path");
        for (const auto &part : std::filesystem::path(name)) {
            auto component = part.wstring();
            require(!component.empty() && component.back() != L'.' && component.back() != L' ',
                    "Invalid runtime manifest path");
        }
        auto folded = name;
        for (auto &c : folded) c = static_cast<wchar_t>(towlower(c));
        require(names.insert(folded).second, "Duplicate runtime manifest path");
        std::string hash = utf8(std::wstring(entry.GetNamedString(L"sha256")));
        require(hash.size() == 64 && hash.find_first_not_of("0123456789ABCDEFabcdef") == std::string::npos,
                "Invalid runtime manifest hash");
        for (auto &c : hash) c = static_cast<char>(toupper(static_cast<unsigned char>(c)));
        files.push_back({name, hash});
    }
    require(names.count(L"electron.exe") != 0, "Runtime absent from manifest");
    return files;
}

void openDistributionLog(const std::string &name) {
    require(isAdministrator(), "Controleur : elevation requise");
    require(name.size() == 44 && name.starts_with("session-") && name.ends_with(".txt") &&
                name.substr(8, 32).find_first_not_of("0123456789abcdef") == std::string::npos,
            "Nom de diagnostic invalide");
    PWSTR folder = nullptr;
    require(SUCCEEDED(SHGetKnownFolderPath(FOLDERID_ProgramData, 0, nullptr, &folder)), "Cannot locate ProgramData");
    auto directory = std::filesystem::path(folder) / L"MyNEIGE-Logs";
    CoTaskMemFree(folder);
    // The old worker's BU read-only ACL is preserved. Refuse untrusted owners or links first.
    if (std::filesystem::exists(directory)) {
        assertPlainTree(directory);
        PSECURITY_DESCRIPTOR descriptor = nullptr;
        PSID owner = nullptr;
        wincheck(GetNamedSecurityInfoW(const_cast<wchar_t *>(directory.c_str()), SE_FILE_OBJECT,
                    OWNER_SECURITY_INFORMATION, &owner, nullptr, nullptr, nullptr, &descriptor), "Read log owner");
        std::unique_ptr<void, decltype(&LocalFree)> cleanup(descriptor, LocalFree);
        require(IsWellKnownSid(owner, WinBuiltinAdministratorsSid) || IsWellKnownSid(owner, WinLocalSystemSid),
                "Proprietaire du diagnostic non administratif");
    }
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    require(ConvertStringSecurityDescriptorToSecurityDescriptorW(
                L"O:BAG:BAD:P(A;OICI;FA;;;SY)(A;OICI;FA;;;BA)(A;OICI;FRFX;;;BU)", SDDL_REVISION_1,
                &descriptor, nullptr), "Cannot create log ACL");
    std::unique_ptr<void, decltype(&LocalFree)> cleanup(descriptor, LocalFree);
    SECURITY_ATTRIBUTES sa{sizeof(sa), descriptor, FALSE};
    if (!CreateDirectoryW(directory.c_str(), &sa))
        require(GetLastError() == ERROR_ALREADY_EXISTS, "Cannot create log directory");
    require(SetFileSecurityW(directory.c_str(), OWNER_SECURITY_INFORMATION | GROUP_SECURITY_INFORMATION |
                DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION, descriptor), "Cannot protect logs");
    auto log = directory / wide(name);
    Handle output(CreateFileW(log.c_str(), GENERIC_WRITE, FILE_SHARE_READ, &sa, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr));
    require(output.h != INVALID_HANDLE_VALUE, "Diagnostic deja present ou inaccessible");
    int fd = _open_osfhandle(reinterpret_cast<intptr_t>(output.h), _O_WRONLY | _O_TEXT);
    require(fd >= 0, "Cannot open log descriptor");
    output.release();
    require(_dup2(fd, _fileno(stdout)) == 0 && _dup2(fd, _fileno(stderr)) == 0, "Cannot redirect diagnostics");
    _close(fd);
}
} // namespace neige
