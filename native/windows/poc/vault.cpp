#include "platform.hpp"
#include <shlobj.h>
#include <tlhelp32.h>
#include <wincrypt.h>
#include <winrt/Windows.Foundation.h>
#include <winrt/Windows.Security.Credentials.UI.h>
#include <userconsentverifierinterop.h>

namespace neige {
using namespace winrt::Windows::Security::Credentials::UI;
struct Secret {
    Bytes bytes;
    ~Secret() {
        if (!bytes.empty())
            SecureZeroMemory(bytes.data(), bytes.size());
    }
};
static Bytes decodeHex(const std::string &text) {
    require(!text.empty() && text.size() <= 16384 && text.size() % 2 == 0, "Invalid secret size");
    Bytes result;
    auto digit = [](char c) -> unsigned {
        if (c >= '0' && c <= '9')
            return c - '0';
        if (c >= 'a' && c <= 'f')
            return c - 'a' + 10;
        throw std::runtime_error("Invalid secret encoding");
    };
    for (size_t i = 0; i < text.size(); i += 2)
        result.push_back(static_cast<unsigned char>(digit(text[i]) * 16 + digit(text[i + 1])));
    return result;
}
static std::string encodeHex(const Bytes &bytes) {
    std::string result;
    for (auto byte : bytes) {
        result += "0123456789abcdef"[byte >> 4];
        result += "0123456789abcdef"[byte & 15];
    }
    return result;
}
static void validateSecret(const Bytes &bytes) {
    require(!bytes.empty() && bytes.size() <= 4096 &&
                std::none_of(bytes.begin(), bytes.end(), [](unsigned char c) { return c < 32 || c == 127; }),
            "Invalid credential");
    (void)wide(std::string(bytes.begin(), bytes.end()));
}
static Bytes protect(const Bytes &input, bool encrypt) {
    DATA_BLOB source{static_cast<DWORD>(input.size()), const_cast<BYTE *>(input.data())}, output{};
    BOOL ok = encrypt
                  ? CryptProtectData(&source, nullptr, nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output)
                  : CryptUnprotectData(&source, nullptr, nullptr, nullptr, nullptr, CRYPTPROTECT_UI_FORBIDDEN, &output);
    require(ok != 0, "Windows credential protection failed");
    Bytes result(output.pbData, output.pbData + output.cbData);
    SecureZeroMemory(output.pbData, output.cbData);
    LocalFree(output.pbData);
    return result;
}
static void privateDirectory(const std::filesystem::path &directory) {
    std::filesystem::create_directories(directory);
    const auto attributes = GetFileAttributesW(directory.c_str());
    require(attributes != INVALID_FILE_ATTRIBUTES && !(attributes & FILE_ATTRIBUTE_REPARSE_POINT),
            "Unsafe vault directory");
    const auto sddl = L"D:P(A;OICI;FA;;;SY)(A;OICI;FA;;;" + currentUserSid() + L")";
    PSECURITY_DESCRIPTOR descriptor = nullptr;
    require(ConvertStringSecurityDescriptorToSecurityDescriptorW(sddl.c_str(), SDDL_REVISION_1, &descriptor, nullptr),
            "Vault ACL unavailable");
    std::unique_ptr<void, decltype(&LocalFree)> cleanup(descriptor, LocalFree);
    require(SetFileSecurityW(directory.c_str(), DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
                             descriptor),
            "Cannot protect vault directory");
}
static std::filesystem::path vaultPath() {
    PWSTR local = nullptr;
    winrt::check_hresult(SHGetKnownFolderPath(FOLDERID_LocalAppData, KF_FLAG_DEFAULT, nullptr, &local));
    std::filesystem::path directory = std::filesystem::path(local) / L"MyNEIGE";
    CoTaskMemFree(local);
    privateDirectory(directory);
    return directory / L"credentials.dpapi";
}
static bool present(const std::filesystem::path &file) {
    const auto attributes = GetFileAttributesW(file.c_str());
    if (attributes == INVALID_FILE_ATTRIBUTES) {
        require(GetLastError() == ERROR_FILE_NOT_FOUND, "Cannot inspect vault");
        return false;
    }
    require(!(attributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)), "Unsafe vault file");
    return true;
}
static void save(const std::filesystem::path &file, const Bytes &user, const Bytes &password) {
    validateSecret(user);
    validateSecret(password);
    Secret clear;
    clear.bytes = {'M', 'N', 'V', '1', static_cast<BYTE>(user.size() >> 8), static_cast<BYTE>(user.size())};
    clear.bytes.insert(clear.bytes.end(), user.begin(), user.end());
    clear.bytes.insert(clear.bytes.end(), password.begin(), password.end());
    auto encrypted = protect(clear.bytes, true);
    const auto temporary = file.parent_path() / (L"vault-" + wide(randomHex(16)) + L".tmp");
    try {
        Handle output(
            CreateFileW(temporary.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr));
        require(output.h != INVALID_HANDLE_VALUE, "Cannot create vault");
        DWORD done = 0;
        require(WriteFile(output.h, encrypted.data(), static_cast<DWORD>(encrypted.size()), &done, nullptr) &&
                    done == encrypted.size() && FlushFileBuffers(output.h),
                "Cannot save vault");
        output.reset();
        // Refuse links, including when replacing an existing record.
        (void)present(file);
        require(MoveFileExW(temporary.c_str(), file.c_str(), MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH),
                "Cannot replace vault");
    } catch (...) {
        DeleteFileW(temporary.c_str());
        throw;
    }
}
static void load(const std::filesystem::path &file, Secret &user, Secret &password) {
    require(present(file), "Vault absent");
    Handle input(CreateFileW(file.c_str(), GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING,
                             FILE_FLAG_OPEN_REPARSE_POINT, nullptr));
    require(input.h != INVALID_HANDLE_VALUE, "Cannot read vault");
    BY_HANDLE_FILE_INFORMATION info{};
    require(GetFileInformationByHandle(input.h, &info) &&
                !(info.dwFileAttributes & (FILE_ATTRIBUTE_REPARSE_POINT | FILE_ATTRIBUTE_DIRECTORY)) &&
                info.nFileSizeHigh == 0 && info.nFileSizeLow > 0 && info.nFileSizeLow <= 32768,
            "Invalid vault file");
    Bytes encrypted(info.nFileSizeLow);
    DWORD done = 0;
    require(ReadFile(input.h, encrypted.data(), static_cast<DWORD>(encrypted.size()), &done, nullptr) &&
                done == encrypted.size(),
            "Cannot read complete vault");
    Secret clear;
    clear.bytes = protect(encrypted, false);
    require(clear.bytes.size() >= 8 && std::equal(clear.bytes.begin(), clear.bytes.begin() + 4, "MNV1"),
            "Unsupported vault format");
    size_t length = static_cast<size_t>(clear.bytes[4]) * 256 + clear.bytes[5];
    require(length > 0 && length <= 4096 && clear.bytes.size() > length + 6, "Invalid vault contents");
    user.bytes.assign(clear.bytes.begin() + 6, clear.bytes.begin() + 6 + length);
    password.bytes.assign(clear.bytes.begin() + 6 + length, clear.bytes.end());
    validateSecret(user.bytes);
    validateSecret(password.bytes);
}
static void forget(const std::filesystem::path &file) {
    if (present(file))
        require(DeleteFileW(file.c_str()) != 0, "Cannot delete vault");
}
static DWORD parentProcess() {
    Handle snapshot(CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0));
    require(snapshot.h != INVALID_HANDLE_VALUE, "Cannot verify vault caller");
    PROCESSENTRY32W entry{sizeof(entry)};
    for (BOOL found = Process32FirstW(snapshot.h, &entry); found; found = Process32NextW(snapshot.h, &entry))
        if (entry.th32ProcessID == GetCurrentProcessId())
            return entry.th32ParentProcessID;
    throw std::runtime_error("Vault caller absent");
}
static bool helloAvailable() {
    return UserConsentVerifier::CheckAvailabilityAsync().get() == UserConsentVerifierAvailability::Available;
}
static bool hello(HWND owner, DWORD parent) {
    DWORD pid = 0;
    require(IsWindow(owner) && GetWindowThreadProcessId(owner, &pid) && pid == parent &&
                GetAncestor(owner, GA_ROOT) == owner,
            "Invalid verification window");
    if (!helloAvailable())
        return false;
    auto interop = winrt::get_activation_factory<UserConsentVerifier, IUserConsentVerifierInterop>();
    winrt::hstring message = L"Utiliser les identifiants VPN/CAS enregistrés dans MyNEIGE";
    auto operation = winrt::capture<winrt::Windows::Foundation::IAsyncOperation<UserConsentVerificationResult>>(
        interop, &IUserConsentVerifierInterop::RequestVerificationForWindowAsync, owner,
        reinterpret_cast<HSTRING>(winrt::get_abi(message)));
    return operation.get() == UserConsentVerificationResult::Verified;
}
int vaultWorker() {
    std::string command;
    try {
        require(!isAdministrator(), "Credential helper must not be elevated");
        winrt::init_apartment(winrt::apartment_type::multi_threaded);
        const auto parent = parentProcess();
        Handle process(OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, parent));
        require(process.h != nullptr, "Vault caller unavailable");
        wchar_t image[32768]{};
        DWORD length = 32768;
        require(QueryFullProcessImageNameW(process.h, 0, image, &length), "Cannot identify vault caller");
        // In production the helper and Electron reside in the same protected session.
        require(
            std::filesystem::path(image).lexically_normal() ==
                (std::filesystem::path(imagePath()).parent_path() / L"browser/runtime/electron.exe").lexically_normal(),
            "Unexpected credential caller");
        char c = 0;
        while (std::cin.get(c) && c != '\n') {
            require(command.size() < 17000, "Vault request too large");
            command += c;
        }
        require(c == '\n', "Incomplete vault request");
        const auto file = vaultPath();
        if (command == "STATUS") {
            bool available = false;
            try {
                available = helloAvailable();
            } catch (...) { /* No automatic fallback. */
            }
            std::cout << "STATUS " << (present(file) ? "PRESENT" : "EMPTY") << " "
                      << (available ? "AVAILABLE" : "UNAVAILABLE") << "\n";
        } else if (command == "DELETE") {
            forget(file);
            std::cout << "OK\n";
        } else if (command.rfind("WRITE ", 0) == 0) {
            auto fields = split(command, ' ');
            wipe(command);
            require(fields.size() == 3, "Invalid save request");
            Secret user, password;
            try {
                user.bytes = decodeHex(fields[1]);
                password.bytes = decodeHex(fields[2]);
            } catch (...) {
                for (auto &field : fields)
                    wipe(field);
                throw;
            }
            for (auto &field : fields)
                wipe(field);
            save(file, user.bytes, password.bytes);
            std::cout << "OK\n";
        } else if (command.rfind("UNLOCK ", 0) == 0) {
            const auto value = command.substr(7);
            require(!value.empty() && value.size() <= 20 && value.find_first_not_of("0123456789") == std::string::npos,
                    "Invalid owner");
            auto owner = reinterpret_cast<HWND>(static_cast<uintptr_t>(std::stoull(value)));
            if (!hello(owner, parent)) {
                std::cout << "DENIED\n";
                return 0;
            }
            Secret user, password;
            load(file, user, password);
            auto frame = "CREDENTIALS " + encodeHex(user.bytes) + " " + encodeHex(password.bytes) + "\n";
            std::cout << frame;
            wipe(frame);
        } else
            throw std::runtime_error("Unsupported vault operation");
        wipe(command);
        return 0;
    } catch (...) {
        wipe(command);
        std::cout << "VAULT_ERROR\n";
        return 1;
    }
}
int vaultSelfTest() {
    wchar_t temporary[MAX_PATH]{};
    require(GetTempPathW(MAX_PATH, temporary), "Temporary directory unavailable");
    const auto directory = std::filesystem::path(temporary) / (L"MyNEIGE-vault-test-" + wide(randomHex(16)));
    privateDirectory(directory);
    const auto file = directory / L"test.dpapi";
    try {
        require(!present(file), "Unexpected fixture file");
        Bytes user{'f', 'i', 'c', 't', 'i', 'f'}, password{'t', 'e', 's', 't', '-', 's', 'e', 'u', 'l'};
        save(file, user, password);
        Secret readUser, readPassword;
        load(file, readUser, readPassword);
        require(readUser.bytes == user && readPassword.bytes == password, "DPAPI roundtrip failed");
        {
            std::ofstream corrupt(file, std::ios::binary | std::ios::trunc);
            corrupt << "invalid fixture";
        }
        bool refused = false;
        try {
            load(file, readUser, readPassword);
        } catch (...) {
            refused = true;
        }
        require(refused, "Corrupt vault accepted");
        forget(file);
        forget(file);
        require(!present(file), "Vault deletion failed");
        std::filesystem::remove(directory);
        std::cout << "VAULT_TEST dpapi=true tamper_refused=true deletion=true no_real_credentials=true\n";
        return 0;
    } catch (...) {
        DeleteFileW(file.c_str());
        std::filesystem::remove(directory);
        throw;
    }
}
int vaultForget() {
    require(!isAdministrator(), "Run credential deletion as the interactive user without elevation");
    forget(vaultPath());
    std::cout << "VAULT_DELETED\n";
    return 0;
}
} // namespace neige
