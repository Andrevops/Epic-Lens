.PHONY: build compile watch package release release-patch release-minor release-major install clean

# Build everything (webview + extension)
build:
	npm run build

# Compile extension only (no webview)
compile:
	npm run compile

# Watch mode for development
watch:
	npm run watch

# Build and package .vsix
package:
	npm run package

# Auto-detect bump from conventional commits, build, and package
release:
	npm run release

# Force bump types
release-patch:
	npm run release:patch

release-minor:
	npm run release:minor

release-major:
	npm run release:major

# Install the latest .vsix locally
install:
	@vsix=$$(ls -t epic-lens-*.vsix 2>/dev/null | head -1); \
	if [ -z "$$vsix" ]; then echo "No .vsix found. Run 'make package' first."; exit 1; fi; \
	echo "Installing $$vsix"; \
	code --install-extension "$$vsix" --force

# Remove build artifacts
clean:
	rm -rf dist/ webview-ui/dist/ epic-lens-*.vsix
