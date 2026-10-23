#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <filesystem>
#include <string>

// PowerShell is the Windows inbox orchestrator; only the controller is elevated.
int WINAPI wWinMain(HINSTANCE, HINSTANCE, PWSTR, int) {
    int argc = 0;
    auto argv = CommandLineToArgvW(GetCommandLineW(), &argc);
    if (!argv) return 1;
    std::wstring mode;
    if (argc == 2) {
        const std::wstring argument = argv[1];
        if (argument == L"--check") mode = L" -CheckOnly";
        else if (argument == L"--browser-test") mode = L" -BrowserTest";
        else if (argument == L"--forget-credentials") mode = L" -ForgetCredentials";
        else if (argument == L"--reset-user-data") mode = L" -ResetUserData";
        else argc = 0;
    }
    LocalFree(argv);
    if (argc < 1 || argc > 2) {
        MessageBoxW(nullptr, L"Option de lancement inconnue.", L"MyNEIGE", MB_OK | MB_ICONERROR);
        return 2;
    }
    // Shared with NSIS so replacement/removal cannot race an active launcher.
    const auto mutex = CreateMutexW(nullptr, TRUE, L"Global\\MyNEIGE-Desktop-v1");
    const auto mutexError = GetLastError();
    if (!mutex || mutexError == ERROR_ALREADY_EXISTS) {
        if (mutex) CloseHandle(mutex);
        MessageBoxW(nullptr, L"MyNEIGE ou son installateur est déjà en cours. Fermez-le avant de réessayer.",
                    L"MyNEIGE", MB_OK | MB_ICONINFORMATION);
        return 3;
    }
    wchar_t executable[32768]{}, system[32768]{};
    const auto imageLength = GetModuleFileNameW(nullptr, executable, 32768);
    const auto systemLength = GetSystemDirectoryW(system, 32768);
    if (!imageLength || imageLength >= 32768 || !systemLength || systemLength >= 32768) {
        CloseHandle(mutex);
        return 1;
    }
    const auto root = std::filesystem::path(executable).parent_path();
    const auto powershell = std::filesystem::path(system) / L"WindowsPowerShell/v1.0/powershell.exe";
    const auto script = root / L"scripts/launch-distribution.ps1";
    std::wstring command = L"\"" + powershell.wstring() + L"\" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" +
                           script.wstring() + L"\"" + mode;
    STARTUPINFOW info{};
    info.cb = sizeof(info);
    PWSTR local = nullptr;
    HANDLE output = INVALID_HANDLE_VALUE, input = INVALID_HANDLE_VALUE;
    std::filesystem::path bootstrap;
    SECURITY_ATTRIBUTES inheritance{sizeof(inheritance), nullptr, TRUE};
    if (SUCCEEDED(SHGetKnownFolderPath(FOLDERID_LocalAppData, KF_FLAG_DEFAULT, nullptr, &local))) {
        bootstrap = std::filesystem::path(local) / L"MyNEIGE/logs";
        CoTaskMemFree(local);
        std::error_code error;
        std::filesystem::create_directories(bootstrap, error);
        bootstrap /= L"launcher-" + std::to_wstring(GetCurrentProcessId()) + L".txt";
        output = CreateFileW(bootstrap.c_str(), GENERIC_WRITE, FILE_SHARE_READ | FILE_SHARE_DELETE,
                             &inheritance, CREATE_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
    }
    input = CreateFileW(L"NUL", GENERIC_READ, FILE_SHARE_READ | FILE_SHARE_WRITE, &inheritance,
                        OPEN_EXISTING, 0, nullptr);
    if (output != INVALID_HANDLE_VALUE && input != INVALID_HANDLE_VALUE) {
        info.dwFlags = STARTF_USESTDHANDLES;
        info.hStdInput = input;
        info.hStdOutput = output;
        info.hStdError = output;
    }
    PROCESS_INFORMATION process{};
    // PowerShell 7 can export its module path to native children. Windows
    // PowerShell must rebuild its own inbox module paths (e.g. Get-FileHash).
    SetEnvironmentVariableW(L"PSModulePath", nullptr);
    const auto started = CreateProcessW(powershell.c_str(), command.data(), nullptr, nullptr, TRUE,
                                        CREATE_NO_WINDOW, nullptr, root.c_str(), &info, &process);
    DWORD code = 1;
    if (started) {
        CloseHandle(process.hThread);
        WaitForSingleObject(process.hProcess, INFINITE);
        GetExitCodeProcess(process.hProcess, &code);
        CloseHandle(process.hProcess);
    } else {
        MessageBoxW(nullptr, L"Impossible de démarrer MyNEIGE. Vérifiez que tous les fichiers ont été extraits et que Windows PowerShell est disponible.",
                    L"MyNEIGE", MB_OK | MB_ICONERROR);
    }
    if (output != INVALID_HANDLE_VALUE) CloseHandle(output);
    if (input != INVALID_HANDLE_VALUE) CloseHandle(input);
    std::error_code logError;
    if (code == 1 && mode != L" -CheckOnly" && !bootstrap.empty() &&
        std::filesystem::file_size(bootstrap, logError) > 0 && !logError) {
        const auto message = L"Le démarrage a échoué. Diagnostic :\n" + bootstrap.wstring();
        MessageBoxW(nullptr, message.c_str(), L"MyNEIGE", MB_OK | MB_ICONERROR);
    }
    CloseHandle(mutex);
    return static_cast<int>(code);
}
