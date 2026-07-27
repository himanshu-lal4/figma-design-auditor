# Figma Design System Auditor

Score, audit, fix, and clean up Figma files so AI-generated code comes out right — especially for React Native cross-platform apps.

**[→ Install from the Figma Community](https://www.figma.com/community/plugin/1604611697351063503/figma-design-system-auditor)** · Runs in Figma, FigJam, and Dev Mode · No network access

## Why this exists

When developers use AI to generate code from Figma files, design quality directly determines code quality. Unnamed layers, missing Auto Layout, and unbound tokens are the difference between clean components and a mess. This plugin catches those issues before they reach the developer.

## Four tabs

### 1. AI Ready

- Scores your design 0–100 across six quality dimensions: Naming, Token Binding, Auto Layout, Structure, Spacing, and Readability
- **Prompt Generator** — builds complete AI code prompts with design tokens, layer tree, navigation architecture, and component mapping for Expo or React Native CLI
- **Component Mapping** — auto-detects Figma components and maps them to React Native equivalents (Button → TouchableOpacity, Input → TextInput, …) with confidence scoring
- Expandable issue lists with click-to-select — tap any finding to select the node in Figma

### 2. Audit

- Full design-system health check across seven quality dimensions, scored 0–100
- Clickable stat cards for unnamed layers, missing Auto Layout, generic property names, missing descriptions, inconsistent boolean naming, missing component states, and duplicate token groups
- Export results as a markdown report

### 3. Fix

- Smart, context-aware rename suggestions for unnamed layers — analyses text content, icons, images, and parent context
- Find & Replace across all layer names
- Auto-generate descriptions for components missing them
- **Auto Layout Check** — scans every frame without Auto Layout and suggests the correct direction (H/V) from child positions; apply in bulk with configurable gap and padding

### 4. Cleanup

- Finds detached instances, unused styles, layer issues, missing annotations, and accessibility problems
- Bulk fix actions for common issues

Every issue is clickable — tap any finding to select the node in Figma and fix it immediately.

## Permissions

None. The plugin makes no network requests — everything runs locally in your file.

## Support

himanshulal56@gmail.com · [more of my work](https://github.com/himanshu-lal4)
