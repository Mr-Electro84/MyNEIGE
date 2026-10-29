#include "startup.hpp"
#include <winrt/Windows.Data.Json.h>
#include <winrt/Windows.Foundation.Collections.h>
#include <limits>
#include <shlobj.h>
#include <aclapi.h>
#include <io.h>
#include <fcntl.h>

namespace neige {
class Sha256 {
    BCRYPT_ALG_HANDLE algorithm = nullptr;
    BCRYPT_HASH_HANDLE hash = nullptr;
public:
    Sha256() {
        require(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) == 0,
                "Cannot open SHA256 provider");
        if (BCryptCreateHash(algorithm, &hash, nullptr, 0, nullptr, 0, 0) != 0) {
            BCryptCloseAlgorithmProvider(algorithm, 0);
            throw std::runtime_error("Cannot create SHA256 hash");
        }
    }
    ~Sha256() {
        BCryptDestroyHash(hash);
        BCryptCloseAlgorithmProvider(algorithm, 0);
    }
    void add(const void *bytes, ULONG size) {
        require(BCryptHashData(hash, static_cast<PUCHAR>(const_cast<void *>(bytes)), size, 0) == 0,
                "Cannot hash data");
    }
    std::string finish() {
        unsigned char digest[32]{};
        require(BCryptFinishHash(hash, digest, sizeof(digest), 0) == 0, "Cannot finish SHA256");
        const char *hex = "0123456789ABCDEF";
        std::string result;
        for (auto byte : digest) {
            result += hex[byte >> 4];
            result += hex[byte & 15];
        }
        return result;
    }
};
std::string sha256Text(const std::string &text) {
    Sha256 hash;
    require(text.size() <= std::numeric_limits<ULONG>::max(), "Hash input too large");
    hash.add(text.data(), static_cast<ULONG>(text.size()));
    return hash.finish();
}
std::string sha256File(const std::filesystem::path &path) {
    Handle file(CreateFileW(path.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                            FILE_FLAG_SEQUENTIAL_SCAN | FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    require(file.h != INVALID_HANDLE_VALUE, "Fichier du programme manquant ou inaccessible");
    FILE_ATTRIBUTE_TAG_INFO attributes{};
    require(GetFileInformationByHandleEx(file.h, FileAttributeTagInfo, &attributes, sizeof(attributes)) &&
                !(attributes.FileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)),
            "Lien ou fichier du programme invalide");
    Sha256 hash;
    Bytes buffer(1024 * 1024);
    DWORD got = 0;
    for (;;) {
        require(ReadFile(file.h, buffer.data(), static_cast<DWORD>(buffer.size()), &got, nullptr) != 0,
                "Cannot read file for SHA256");
        if (!got) break;
        hash.add(buffer.data(), got);
    }
    return hash.finish();
}
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
    for (const auto *required : {L"myneige.exe", L"bin/myneige-controller.exe", L"resources/runtime/electron.exe",
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
