#pragma once
#include "platform.hpp"
namespace neige {
std::string sha256File(const std::filesystem::path &path);
std::string sha256Text(const std::string &text);
void assertPlainTree(const std::filesystem::path &root);
void validateDistribution(const std::filesystem::path &root);
struct RuntimeFile {
    std::filesystem::path relative;
    std::string hash;
};
std::vector<RuntimeFile> runtimeManifest(const std::filesystem::path &source);
void prepareRuntime(const std::filesystem::path &source, const std::filesystem::path &destination,
                    const std::filesystem::path &protectedRoot);
void openDistributionLog(const std::string &name);
int runtimeCacheTest(const std::filesystem::path &projectRoot);
int runtimeCacheProbe(const std::filesystem::path &path);
} // namespace neige
