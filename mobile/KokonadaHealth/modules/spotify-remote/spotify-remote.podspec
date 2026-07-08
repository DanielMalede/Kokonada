require "json"
package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "spotify-remote"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = "https://kokonada.app"
  s.license      = "UNLICENSED"
  s.authors      = "Kokonada"
  s.platforms    = { :ios => "13.0" }
  s.source       = { :git => "" }
  s.source_files = "ios/**/*.{swift}"
  install_modules_dependencies(s)
end
