#include "hash.hpp"
#include <limits>
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
} // namespace neige
