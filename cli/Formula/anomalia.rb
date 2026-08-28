# typed: false
# frozen_string_literal: true

# Homebrew formula for the Anomalia CLI (prebuilt binaries from GitHub Releases).
#
# Install (dedicated tap, kept in sync by the cli-v* release workflow):
#   brew tap anomaliaso/tap https://github.com/anomaliaso/homebrew-tap
#   brew install anomalia
#
# SHA256 placeholders below are filled by .github/workflows/release.yml on each v* tag.

class Anomalia < Formula
  desc "Command-line client for Anomalia — social media AI autopilot"
  homepage "https://anomalia.so"
  version "0.1.0"
  license "AGPL-3.0-or-later"

  livecheck do
    url "https://github.com/anomaliaso/anomalia/releases/latest"
    strategy :github_latest
  end

  on_macos do
    on_arm do
      url "https://github.com/anomaliaso/anomalia/releases/download/v#{version}/anomalia-macos-arm64.tar.gz"
      sha256 "REPLACE_SHA256_MACOS_ARM64"
    end
    on_intel do
      url "https://github.com/anomaliaso/anomalia/releases/download/v#{version}/anomalia-macos-x64.tar.gz"
      sha256 "REPLACE_SHA256_MACOS_X64"
    end
  end

  on_linux do
    on_arm do
      url "https://github.com/anomaliaso/anomalia/releases/download/v#{version}/anomalia-linux-arm64.tar.gz"
      sha256 "REPLACE_SHA256_LINUX_ARM64"
    end
    on_intel do
      url "https://github.com/anomaliaso/anomalia/releases/download/v#{version}/anomalia-linux-x64.tar.gz"
      sha256 "REPLACE_SHA256_LINUX_X64"
    end
  end

  def install
    binary = Dir["anomalia-*"].first
    odie "Anomalia binary missing from archive" if binary.nil?
    bin.install binary => "anomalia"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/anomalia --version")
  end
end
