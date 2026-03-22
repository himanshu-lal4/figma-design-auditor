// Design System Auditor — Plugin Code
// Runs in Figma's sandbox with access to the document API

figma.showUI(__html__, { width: 560, height: 680, themeColors: true });

// ═══════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════

var UNNAMED_PATTERN = /^(Frame|Group|Rectangle|Ellipse|Line|Vector|Image|Polygon|Star|Slice|Boolean)\s*\d*$/;

var BOOLEAN_SUSPECT_PATTERN = /^(.+?)\s*\??\s*=\s*(yes|no|true|false|on|off|gone)\s*$/i;

// Expected states by component type keyword
var EXPECTED_STATES = {
  button: ['Default', 'Pressed', 'Disabled', 'Loading'],
  input: ['Default', 'Focused', 'Filled', 'Error', 'Disabled'],
  switch: ['Default', 'Disabled'],
  checkbox: ['Default', 'Error', 'Disabled'],
  radio: ['Default', 'Error', 'Disabled'],
  toast: ['Success', 'Error', 'Warning', 'Info'],
  card: ['Default', 'Elevated', 'Outlined'],
  tab: ['Default', 'Active', 'Disabled'],
  chip: ['Default', 'Selected', 'Disabled'],
  badge: ['Default'],
  dialog: ['Default'],
  avatar: ['Default'],
  dropdown: ['Default', 'Open', 'Disabled'],
  textarea: ['Default', 'Focused', 'Filled', 'Error', 'Disabled'],
  select: ['Default', 'Open', 'Focused', 'Error', 'Disabled']
};

function walk(node, callback) {
  callback(node);
  if ('children' in node) {
    for (var i = 0; i < node.children.length; i++) {
      walk(node.children[i], callback);
    }
  }
}

function nodePath(node) {
  var parts = [];
  var current = node.parent;
  var depth = 0;
  while (current && current.type !== 'PAGE' && depth < 4) {
    parts.unshift(current.name);
    current = current.parent;
    depth++;
  }
  return parts.join(' / ') || '(page root)';
}

function serializeNode(node) {
  return {
    id: node.id,
    name: node.name,
    type: node.type,
    path: nodePath(node),
    childCount: 'children' in node ? node.children.length : 0
  };
}

function isVariantComponent(node) {
  return node.type === 'COMPONENT' && node.parent && node.parent.type === 'COMPONENT_SET';
}

function suggestName(node) {
  // Heuristic name suggestion based on node type, children, and content
  if (node.type === 'TEXT') {
    try {
      var chars = node.characters;
      if (typeof chars === 'string' && chars.length > 0) {
        var words = chars.trim().split(/\s+/).slice(0, 3).join(' ');
        if (words.length > 30) words = words.substring(0, 30);
        return words;
      }
    } catch (e) {}
    return 'TextLabel';
  }
  if (node.type === 'INSTANCE') {
    try {
      var main = node.mainComponent;
      if (main && main.name) return main.name;
    } catch (e) {}
  }
  if (node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION') return 'Icon';
  if (node.type === 'ELLIPSE') return 'Circle';
  if (node.type === 'RECTANGLE') {
    // Check if it has image fill
    try {
      if (node.fills && Array.isArray(node.fills)) {
        for (var i = 0; i < node.fills.length; i++) {
          if (node.fills[i].type === 'IMAGE') return 'Image';
        }
      }
    } catch (e) {}
    return 'Shape';
  }
  if (node.type === 'LINE') return 'Divider';
  if ('children' in node && node.children.length > 0) {
    // Check first text child for context
    for (var c = 0; c < node.children.length && c < 5; c++) {
      if (node.children[c].type === 'TEXT') {
        try {
          var txt = node.children[c].characters;
          if (typeof txt === 'string' && txt.length > 0 && txt.length <= 30) {
            return txt.trim().split(/\s+/).slice(0, 3).join(' ') + ' Container';
          }
        } catch (e) {}
      }
    }
    return 'Container';
  }
  return 'Layer';
}

// ═══════════════════════════════════════════════════════════
// TAB 2: COMPREHENSIVE AUDIT
// ═══════════════════════════════════════════════════════════

function auditPage(root) {
  if (!root) root = figma.currentPage;
  var unnamed = [];
  var noAutoLayout = [];
  var genericProps = [];
  var noDescription = [];
  var inconsistentBooleans = [];
  var missingStates = [];
  var totalNodes = 0;
  var totalComponents = 0;

  // For missing states: group variant-named nodes
  var variantsByParent = {};
  // For duplicate tokens

  walk(root, function(node) {
    if (node.type === 'PAGE') return;
    totalNodes++;

    // 1. Unnamed layers
    if (UNNAMED_PATTERN.test(node.name)) {
      unnamed.push(serializeNode(node));
    }

    // 2. Frames without Auto Layout (only frames with children)
    if (node.type === 'FRAME' && 'children' in node && node.children.length > 0) {
      if (!node.layoutMode || node.layoutMode === 'NONE') {
        noAutoLayout.push(serializeNode(node));
      }
    }

    // 3. Components with "Property 1" in variant property names
    if ((node.type === 'COMPONENT_SET' || node.type === 'COMPONENT') && !isVariantComponent(node)) {
      totalComponents++;
      try {
        if (node.componentPropertyDefinitions) {
          var defs = node.componentPropertyDefinitions;
          var keys = Object.keys(defs);
          for (var k = 0; k < keys.length; k++) {
            var key = keys[k];
            if (key.toLowerCase().includes('property 1') || key.toLowerCase().includes('property1')) {
              var entry = serializeNode(node);
              entry.propertyName = key;
              genericProps.push(entry);
              break;
            }
          }
        }
      } catch (e) {
        // Skip nodes where property access fails
      }
    }

    // Also check variant names in frame/component names
    if (node.type === 'FRAME' || node.type === 'COMPONENT') {
      if (node.name.includes('Property 1=') || node.name.includes('Property1=')) {
        if (!genericProps.find(function(g) { return g.id === node.id; })) {
          var entry2 = serializeNode(node);
          entry2.propertyName = 'Property 1 (in name)';
          genericProps.push(entry2);
        }
      }
    }

    // 4. Components without descriptions (skip variant components)
    if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && !isVariantComponent(node)) {
      try {
        if (!node.description || node.description.trim() === '') {
          noDescription.push(serializeNode(node));
        }
      } catch (e) {
        // Skip
      }
    }

    // 5. Inconsistent boolean naming
    if (node.type === 'FRAME' || node.type === 'COMPONENT') {
      var parts = node.name.split(',');
      for (var p = 0; p < parts.length; p++) {
        var part = parts[p].trim();
        var boolMatch = part.match(BOOLEAN_SUSPECT_PATTERN);
        if (boolMatch) {
          var propName = boolMatch[1].trim();
          var propValue = boolMatch[2].toLowerCase();
          // Flag if: name ends with ?, value is yes/no/gone, or name doesn't follow isX/hasX convention
          var hasQuestionMark = propName.endsWith('?');
          var isNonStandard = propValue === 'gone' || propValue === 'on' || propValue === 'off';
          var lacksPrefix = !propName.toLowerCase().startsWith('is') && !propName.toLowerCase().startsWith('has') && !propName.toLowerCase().startsWith('show');

          if (hasQuestionMark || isNonStandard || (lacksPrefix && (propValue === 'yes' || propValue === 'no'))) {
            var existing = inconsistentBooleans.find(function(b) { return b.propertyName === propName; });
            if (!existing) {
              var boolEntry = serializeNode(node);
              boolEntry.propertyName = propName;
              boolEntry.currentValue = propValue;
              boolEntry.suggestion = suggestBooleanName(propName);
              inconsistentBooleans.push(boolEntry);
            }
          }
        }
      }
    }

    // 6. Collect variant info for missing states check
    if (node.type === 'FRAME' || node.type === 'COMPONENT') {
      var stateMatch = node.name.match(/State\s*=\s*([^,]+)/i);
      if (stateMatch) {
        var parentId = node.parent ? node.parent.id : 'root';
        var parentName = node.parent ? node.parent.name : 'Page';
        if (!variantsByParent[parentId]) {
          variantsByParent[parentId] = {
            parentName: parentName,
            parentId: parentId,
            states: [],
            componentName: '',
            sampleNodeId: node.id
          };
        }
        var stateName = stateMatch[1].trim();
        if (variantsByParent[parentId].states.indexOf(stateName) === -1) {
          variantsByParent[parentId].states.push(stateName);
        }
        // Try to extract base component name
        if (!variantsByParent[parentId].componentName) {
          variantsByParent[parentId].componentName = parentName;
        }
      }
    }

  });

  // Process missing states
  var parentIds = Object.keys(variantsByParent);
  for (var vi = 0; vi < parentIds.length; vi++) {
    var group = variantsByParent[parentIds[vi]];
    var compNameLower = group.componentName.toLowerCase();
    var expectedKeys = Object.keys(EXPECTED_STATES);
    var matchedType = null;

    for (var ei = 0; ei < expectedKeys.length; ei++) {
      if (compNameLower.includes(expectedKeys[ei])) {
        matchedType = expectedKeys[ei];
        break;
      }
    }

    if (matchedType) {
      var expected = EXPECTED_STATES[matchedType];
      var missing = [];
      for (var si = 0; si < expected.length; si++) {
        var found = false;
        for (var gi = 0; gi < group.states.length; gi++) {
          if (group.states[gi].toLowerCase() === expected[si].toLowerCase()) {
            found = true;
            break;
          }
        }
        if (!found) missing.push(expected[si]);
      }

      if (missing.length > 0) {
        missingStates.push({
          parentId: group.parentId,
          parentName: group.parentName,
          componentName: group.componentName,
          componentType: matchedType,
          existingStates: group.states,
          missingStates: missing,
          sampleNodeId: group.sampleNodeId
        });
      }
    }
  }


  // Calculate score (0-100)
  var score = calculateScore(totalNodes, totalComponents, unnamed.length, noAutoLayout.length, genericProps.length, noDescription.length, inconsistentBooleans.length, missingStates.length);

  return {
    unnamed: unnamed,
    noAutoLayout: noAutoLayout,
    genericProps: genericProps,
    noDescription: noDescription,
    inconsistentBooleans: inconsistentBooleans,
    missingStates: missingStates,
    totalNodes: totalNodes,
    totalComponents: totalComponents,
    score: score
  };
}

function suggestBooleanName(propName) {
  var clean = propName.replace(/\?$/, '').trim();
  // Common mappings
  var mappings = {
    'on': 'isEnabled',
    'sent': 'isSent',
    'checked': 'isChecked',
    'selected': 'isSelected',
    'filled': 'isFilled',
    'expanded': 'isExpanded',
    'active': 'isActive',
    'visible': 'isVisible',
    'interactive': 'isInteractive',
    'direction': 'isReversed'
  };
  var lower = clean.toLowerCase();
  if (mappings[lower]) return mappings[lower];
  // Default: add "is" prefix and capitalize
  return 'is' + clean.charAt(0).toUpperCase() + clean.slice(1);
}

function calculateScore(totalNodes, totalComponents, unnamed, noAL, generic, noDesc, booleans, missingStates) {
  if (totalNodes === 0) return 100;

  // Weighted deductions (out of 100)
  var deductions = 0;

  // Unnamed layers: 2 points per, max 15
  deductions += Math.min(unnamed * 2, 15);

  // No Auto Layout: 0.5 points per, max 20
  deductions += Math.min(noAL * 0.5, 20);

  // Generic properties: 3 points per, max 20
  deductions += Math.min(generic * 3, 20);

  // No description: 0.5 points per, max 10
  deductions += Math.min(noDesc * 0.5, 10);

  // Inconsistent booleans: 2 points per, max 15
  deductions += Math.min(booleans * 2, 15);

  // Missing states: 3 points per, max 15
  deductions += Math.min(missingStates * 3, 15);


  return Math.max(0, Math.round(100 - deductions));
}

function generateReport(auditData) {
  var lines = [];
  lines.push('# Design System Auditor Report');
  lines.push('Date: ' + new Date().toISOString().split('T')[0]);
  lines.push('Page: ' + figma.currentPage.name);
  lines.push('Score: ' + auditData.score + '/100');
  lines.push('Total nodes: ' + auditData.totalNodes);
  lines.push('Total components: ' + auditData.totalComponents);
  lines.push('');

  lines.push('## Issues Summary');
  lines.push('- Unnamed layers: ' + auditData.unnamed.length);
  lines.push('- Frames without Auto Layout: ' + auditData.noAutoLayout.length);
  lines.push('- Generic "Property 1" names: ' + auditData.genericProps.length);
  lines.push('- Components without descriptions: ' + auditData.noDescription.length);
  lines.push('- Inconsistent boolean naming: ' + auditData.inconsistentBooleans.length);
  lines.push('- Missing component states: ' + auditData.missingStates.length);
  lines.push('');

  if (auditData.unnamed.length > 0) {
    lines.push('## Unnamed Layers');
    for (var i = 0; i < auditData.unnamed.length; i++) {
      lines.push('- ' + auditData.unnamed[i].name + ' (' + auditData.unnamed[i].path + ')');
    }
    lines.push('');
  }

  if (auditData.genericProps.length > 0) {
    lines.push('## Generic Property Names');
    for (var j = 0; j < auditData.genericProps.length; j++) {
      lines.push('- ' + auditData.genericProps[j].name + ': ' + auditData.genericProps[j].propertyName);
    }
    lines.push('');
  }

  if (auditData.inconsistentBooleans.length > 0) {
    lines.push('## Inconsistent Boolean Naming');
    for (var k = 0; k < auditData.inconsistentBooleans.length; k++) {
      var b = auditData.inconsistentBooleans[k];
      lines.push('- "' + b.propertyName + '=' + b.currentValue + '" -> Suggested: "' + b.suggestion + '"');
    }
    lines.push('');
  }

  if (auditData.missingStates.length > 0) {
    lines.push('## Missing Component States');
    for (var m = 0; m < auditData.missingStates.length; m++) {
      var ms = auditData.missingStates[m];
      lines.push('- ' + ms.componentName + ' (' + ms.componentType + '): missing ' + ms.missingStates.join(', '));
      lines.push('  Existing: ' + ms.existingStates.join(', '));
    }
    lines.push('');
  }


  return lines.join('\n');
}


// ═══════════════════════════════════════════════════════════
// TAB 1: AI READY CHECKS
// ═══════════════════════════════════════════════════════════

var COMPONENT_PREFIX_PATTERN = /^(Screen|Button|Card|Input|Modal|Tab|Switch|Icon|Image|Badge|Chip|Toast|Dialog|Avatar|Dropdown|Select|Textarea|Radio|Checkbox|Header|Footer|Nav|List)\//i;
var PASCAL_CASE_PATTERN = /^[A-Z][a-zA-Z0-9]*$/;
var INSTANCE_DEFAULT_PATTERN = /^Instance\s*\d*$/;
var INTERACTIVE_KEYWORDS = /button|toggle|switch|checkbox|radio|icon|tap|press|click|link/i;
var KNOWN_WIDTHS = [375, 390, 393, 360];

function isInsideInstance(node) {
  var current = node.parent;
  while (current && current.type !== 'PAGE') {
    if (current.type === 'INSTANCE') return true;
    current = current.parent;
  }
  return false;
}

function rgbToHex(r, g, b) {
  var rr = Math.round(r * 255).toString(16);
  var gg = Math.round(g * 255).toString(16);
  var bb = Math.round(b * 255).toString(16);
  if (rr.length === 1) rr = '0' + rr;
  if (gg.length === 1) gg = '0' + gg;
  if (bb.length === 1) bb = '0' + bb;
  return '#' + rr + gg + bb;
}

function luminance(r, g, b) {
  var rs = r <= 0.03928 ? r / 12.92 : Math.pow((r + 0.055) / 1.055, 2.4);
  var gs = g <= 0.03928 ? g / 12.92 : Math.pow((g + 0.055) / 1.055, 2.4);
  var bs = b <= 0.03928 ? b / 12.92 : Math.pow((b + 0.055) / 1.055, 2.4);
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(l1, l2) {
  var lighter = Math.max(l1, l2);
  var darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function findAncestorBackground(node) {
  var current = node.parent;
  while (current && current.type !== 'PAGE') {
    try {
      if (current.fills && Array.isArray(current.fills)) {
        for (var i = 0; i < current.fills.length; i++) {
          if (current.fills[i].type === 'SOLID' && current.fills[i].visible !== false) {
            return current.fills[i].color;
          }
        }
      }
    } catch (e) {}
    current = current.parent;
  }
  return { r: 1, g: 1, b: 1 };
}

function checkNamingConventions() {
  var root = figma.currentPage;
  var issues = [];

  walk(root, function(node) {
    if (node.type === 'PAGE') return;

    // Top-level frames should use Screen/ prefix
    if (node.type === 'FRAME' && node.parent && node.parent.type === 'PAGE') {
      if (!/^Screen\//i.test(node.name)) {
        issues.push({
          id: node.id,
          name: node.name,
          type: node.type,
          path: nodePath(node),
          rule: 'screen-prefix',
          message: 'Top-level frame should use "Screen/" prefix',
          suggestion: 'Screen/' + node.name
        });
      }
    }

    // Components should use Type/Name PascalCase
    if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') {
      if (!isVariantComponent(node)) {
        if (!COMPONENT_PREFIX_PATTERN.test(node.name)) {
          var slashIdx = node.name.indexOf('/');
          if (slashIdx === -1) {
            issues.push({
              id: node.id,
              name: node.name,
              type: node.type,
              path: nodePath(node),
              rule: 'component-prefix',
              message: 'Component should use Type/Name format (e.g., Button/Primary)'
            });
          }
        }

        var firstName = node.name.split('/')[0].trim();
        if (firstName.length > 0 && !PASCAL_CASE_PATTERN.test(firstName) && node.name.indexOf('/') !== -1) {
          issues.push({
            id: node.id,
            name: node.name,
            type: node.type,
            path: nodePath(node),
            rule: 'pascal-case',
            message: 'Component prefix should use PascalCase'
          });
        }
      }
    }

    // Flag instances with auto-generated default names
    if (node.type === 'INSTANCE' && INSTANCE_DEFAULT_PATTERN.test(node.name)) {
      issues.push({
        id: node.id,
        name: node.name,
        type: node.type,
        path: nodePath(node),
        rule: 'instance-default',
        message: 'Instance has auto-generated default name'
      });
    }
  });

  return issues;
}

function checkHardcodedValues() {
  var root = figma.currentPage;
  var issues = [];

  walk(root, function(node) {
    if (node.type === 'PAGE') return;
    if (isInsideInstance(node)) return;

    var isTopFrame = node.type === 'FRAME' && node.parent && node.parent.type === 'PAGE';
    if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET' && !isTopFrame) return;

    try {
      if (node.fills && Array.isArray(node.fills)) {
        for (var i = 0; i < node.fills.length; i++) {
          if (node.fills[i].type === 'SOLID') {
            var hasBoundFill = false;
            try {
              if (node.boundVariables && node.boundVariables.fills) {
                hasBoundFill = true;
              }
            } catch (e2) {}
            if (!hasBoundFill) {
              var color = node.fills[i].color;
              issues.push({
                id: node.id,
                name: node.name,
                type: node.type,
                path: nodePath(node),
                rule: 'unbound-fill',
                message: 'Solid fill not bound to a variable',
                color: color ? rgbToHex(color.r, color.g, color.b) : '#???'
              });
              break;
            }
          }
        }
      }
    } catch (e) {}

    try {
      if (node.strokes && Array.isArray(node.strokes)) {
        for (var j = 0; j < node.strokes.length; j++) {
          if (node.strokes[j].type === 'SOLID') {
            var hasBoundStroke = false;
            try {
              if (node.boundVariables && node.boundVariables.strokes) {
                hasBoundStroke = true;
              }
            } catch (e3) {}
            if (!hasBoundStroke) {
              var sColor = node.strokes[j].color;
              issues.push({
                id: node.id,
                name: node.name,
                type: node.type,
                path: nodePath(node),
                rule: 'unbound-stroke',
                message: 'Stroke not bound to a variable',
                color: sColor ? rgbToHex(sColor.r, sColor.g, sColor.b) : '#???'
              });
              break;
            }
          }
        }
      }
    } catch (e) {}
  });

  return issues;
}

function checkTouchTargets() {
  var root = figma.currentPage;
  var issues = [];

  walk(root, function(node) {
    if (node.type === 'PAGE') return;

    var isInteractive = false;

    if ((node.type === 'COMPONENT' || node.type === 'INSTANCE') && INTERACTIVE_KEYWORDS.test(node.name)) {
      isInteractive = true;
    }

    try {
      if (node.reactions && node.reactions.length > 0) {
        isInteractive = true;
      }
    } catch (e) {}

    if (isInteractive && (node.width < 44 || node.height < 44)) {
      issues.push({
        id: node.id,
        name: node.name,
        type: node.type,
        path: nodePath(node),
        rule: 'small-touch-target',
        message: 'Interactive element smaller than 44x44pt minimum',
        width: Math.round(node.width),
        height: Math.round(node.height)
      });
    }
  });

  return issues;
}

function checkScreenStructure() {
  var root = figma.currentPage;
  var issues = [];
  var children = root.children;

  for (var i = 0; i < children.length; i++) {
    var node = children[i];
    if (node.type !== 'FRAME') continue;

    var width = Math.round(node.width);
    var isStandardWidth = false;
    for (var w = 0; w < KNOWN_WIDTHS.length; w++) {
      if (Math.abs(width - KNOWN_WIDTHS[w]) <= 5) {
        isStandardWidth = true;
        break;
      }
    }

    if (!isStandardWidth) {
      issues.push({
        id: node.id,
        name: node.name,
        type: node.type,
        path: '(top-level)',
        rule: 'non-standard-width',
        message: 'Frame width ' + width + 'px is not a standard device width (360-393)',
        width: width,
        height: Math.round(node.height)
      });
    }

    var hasScrollChild = false;
    if ('children' in node) {
      for (var c = 0; c < node.children.length; c++) {
        if (node.children[c].name.toLowerCase().indexOf('scroll') !== -1) {
          hasScrollChild = true;
          break;
        }
      }
    }

    if (!hasScrollChild && 'children' in node && node.children.length > 0) {
      issues.push({
        id: node.id,
        name: node.name,
        type: node.type,
        path: '(top-level)',
        rule: 'no-scroll-wrapper',
        message: 'No child named "Scroll*" — add a ScrollContent wrapper'
      });
    }

    try {
      if (node.clipsContent === false) {
        issues.push({
          id: node.id,
          name: node.name,
          type: node.type,
          path: '(top-level)',
          rule: 'no-clip-content',
          message: 'Frame does not clip overflow (clipContent is off)'
        });
      }
    } catch (e) {}
  }

  return issues;
}

function checkComponentArchitecture() {
  var root = figma.currentPage;
  var issues = [];

  walk(root, function(node) {
    if (node.type === 'PAGE') return;

    // Groups with 3+ children should be frames
    if (node.type === 'GROUP' && 'children' in node && node.children.length >= 3) {
      issues.push({
        id: node.id,
        name: node.name,
        type: node.type,
        path: nodePath(node),
        rule: 'group-should-be-frame',
        message: 'Group with ' + node.children.length + ' children — consider Frame with Auto Layout'
      });
    }

    // Deep nesting inside components
    if (node.type !== 'PAGE' && node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
      var depth = 0;
      var current = node.parent;
      var foundComponent = false;
      while (current && current.type !== 'PAGE') {
        depth++;
        if (current.type === 'COMPONENT' || current.type === 'COMPONENT_SET') {
          foundComponent = true;
          break;
        }
        current = current.parent;
      }

      if (foundComponent && depth > 5) {
        issues.push({
          id: node.id,
          name: node.name,
          type: node.type,
          path: nodePath(node),
          rule: 'deep-nesting',
          message: 'Nested ' + depth + ' levels deep inside component — flatten'
        });
      }
    }

    // Component Set with only 1 variant
    if (node.type === 'COMPONENT_SET' && 'children' in node && node.children.length === 1) {
      issues.push({
        id: node.id,
        name: node.name,
        type: node.type,
        path: nodePath(node),
        rule: 'single-variant',
        message: 'Component Set has only 1 variant'
      });
    }
  });

  return issues;
}

function checkAccessibility() {
  var root = figma.currentPage;
  var issues = [];

  walk(root, function(node) {
    if (node.type === 'PAGE') return;

    // Text font size check
    if (node.type === 'TEXT') {
      try {
        var fontSize = node.fontSize;
        if (typeof fontSize === 'number' && fontSize < 12) {
          issues.push({
            id: node.id,
            name: node.name,
            type: node.type,
            path: nodePath(node),
            rule: 'small-text',
            message: 'Font size ' + fontSize + 'px is below minimum 12px',
            fontSize: fontSize
          });
        }
      } catch (e) {}

      // Color contrast check
      try {
        var textFills = node.fills;
        if (textFills && Array.isArray(textFills) && textFills.length > 0 && textFills[0].type === 'SOLID') {
          var textColor = textFills[0].color;
          var bgColor = findAncestorBackground(node);
          if (textColor && bgColor) {
            var textL = luminance(textColor.r, textColor.g, textColor.b);
            var bgL = luminance(bgColor.r, bgColor.g, bgColor.b);
            var ratio = contrastRatio(textL, bgL);

            var isLargeText = false;
            var fs = node.fontSize;
            if (typeof fs === 'number') {
              if (fs >= 18) {
                isLargeText = true;
              } else if (fs >= 14) {
                try {
                  var fontName = node.fontName;
                  if (fontName && typeof fontName === 'object' && fontName.style) {
                    var style = fontName.style.toLowerCase();
                    if (style.indexOf('bold') !== -1 || style.indexOf('black') !== -1 || style.indexOf('heavy') !== -1) {
                      isLargeText = true;
                    }
                  }
                } catch (e2) {}
              }
            }

            var minRatio = isLargeText ? 3 : 4.5;
            if (ratio < minRatio) {
              issues.push({
                id: node.id,
                name: node.name,
                type: node.type,
                path: nodePath(node),
                rule: 'low-contrast',
                message: 'Contrast ' + ratio.toFixed(1) + ':1 below ' + minRatio + ':1 minimum',
                ratio: Math.round(ratio * 10) / 10,
                textColor: rgbToHex(textColor.r, textColor.g, textColor.b),
                bgColor: rgbToHex(bgColor.r, bgColor.g, bgColor.b)
              });
            }
          }
        }
      } catch (e) {}
    }

    // Images with generic names
    var hasImageFill = false;
    try {
      if (node.fills && Array.isArray(node.fills)) {
        for (var f = 0; f < node.fills.length; f++) {
          if (node.fills[f].type === 'IMAGE') {
            hasImageFill = true;
            break;
          }
        }
      }
    } catch (e) {}

    if (hasImageFill && UNNAMED_PATTERN.test(node.name)) {
      issues.push({
        id: node.id,
        name: node.name,
        type: node.type,
        path: nodePath(node),
        rule: 'unnamed-image',
        message: 'Image has a generic name — needs meaningful name for accessibility'
      });
    }

    // Icon components too small
    if ((node.type === 'COMPONENT' || node.type === 'INSTANCE') && node.name.toLowerCase().indexOf('icon') !== -1) {
      if (node.width < 24 || node.height < 24) {
        issues.push({
          id: node.id,
          name: node.name,
          type: node.type,
          path: nodePath(node),
          rule: 'small-icon',
          message: 'Icon is ' + Math.round(node.width) + 'x' + Math.round(node.height) + ' — minimum 24x24',
          width: Math.round(node.width),
          height: Math.round(node.height)
        });
      }
    }
  });

  return issues;
}

// ═══════════════════════════════════════════════════════════
// TAB 1: AI READY — AI CODE GENERATION QUALITY SCORING
// ═══════════════════════════════════════════════════════════
// Guard rail: max issues per category to prevent UI overload on large files
var MCP_MAX_ISSUES_PER_CATEGORY = 200;
// Guard rail: skip nodes deeper than this to prevent perf issues
var MCP_MAX_DEPTH = 20;

function isNearWhite(color) {
  return color.r > 0.95 && color.g > 0.95 && color.b > 0.95;
}

function checkMcpNaming(root) {
  var issues = [];

  walk(root, function(node) {
    if (node.type === 'PAGE') return;
    if (issues.length >= MCP_MAX_ISSUES_PER_CATEGORY) return;

    // Unnamed layers — default Figma names like "Frame 1", "Rectangle 47", "Group 3"
    if (UNNAMED_PATTERN.test(node.name)) {
      // Check if it has an image fill (separate rule below)
      var hasImageFill = false;
      try {
        if (node.fills && Array.isArray(node.fills)) {
          for (var f = 0; f < node.fills.length; f++) {
            if (node.fills[f].type === 'IMAGE') { hasImageFill = true; break; }
          }
        }
      } catch (e) {}

      if (hasImageFill) {
        issues.push({
          id: node.id,
          name: node.name,
          type: node.type,
          path: nodePath(node),
          rule: 'unnamed-image',
          message: 'Image has generic name — AI will generate meaningless alt text',
          suggestion: suggestName(node),
          tooltip: 'AI uses image layer names for alt text and variable names. "Rectangle 5" becomes a useless identifier.'
        });
      } else {
        issues.push({
          id: node.id,
          name: node.name,
          type: node.type,
          path: nodePath(node),
          rule: 'unnamed-layer',
          message: 'Default layer name — AI will use this as a code identifier',
          suggestion: suggestName(node),
          tooltip: 'AI reads layer names to generate variable and component names. "Frame 47" becomes meaningless code.'
        });
      }
      return; // skip further naming checks on this node
    }

    // Appearance-based names — names describing color not purpose
    if ((node.type === 'COMPONENT' || node.type === 'FRAME' || node.type === 'INSTANCE') && !isVariantComponent(node)) {
      if (COLOR_WORD_PATTERN.test(node.name) && node.name.indexOf('/') === -1) {
        issues.push({
          id: node.id,
          name: node.name,
          type: node.type,
          path: nodePath(node),
          rule: 'appearance-name',
          message: 'Name describes color, not purpose — rename to what it does',
          tooltip: 'AI will name a component "RedBox" instead of "ErrorAlert". Semantic names produce better code.'
        });
      }
    }

    // Instances with auto-generated default names
    if (node.type === 'INSTANCE' && INSTANCE_DEFAULT_PATTERN.test(node.name)) {
      issues.push({
        id: node.id,
        name: node.name,
        type: node.type,
        path: nodePath(node),
        rule: 'instance-default',
        message: 'Instance has auto-generated name',
        tooltip: 'AI uses instance names to understand component usage context.'
      });
    }
  });

  return issues;
}

function checkMcpTokenBinding(root) {
  var issues = [];
  var stats = {
    boundFills: 0, unboundFills: 0,
    boundStrokes: 0, unboundStrokes: 0,
    boundText: 0, unboundText: 0,
    boundEffects: 0, unboundEffects: 0
  };

  walk(root, function(node) {
    if (node.type === 'PAGE') return;
    if (isInsideInstance(node)) return;
    if (issues.length >= MCP_MAX_ISSUES_PER_CATEGORY) return;

    // Check fills — walk ALL nodes, not just components/top-frames
    try {
      if (node.fills && Array.isArray(node.fills)) {
        for (var i = 0; i < node.fills.length; i++) {
          var fill = node.fills[i];
          if (fill.type !== 'SOLID') continue;
          if (fill.visible === false) continue;
          // Skip near-white fills on frames — too noisy (backgrounds)
          if (fill.color && isNearWhite(fill.color) && (node.type === 'FRAME' || node.type === 'GROUP')) continue;

          var hasBoundFill = false;
          try {
            if (node.boundVariables && node.boundVariables.fills) {
              hasBoundFill = true;
            }
            if (!hasBoundFill && node.fillStyleId && node.fillStyleId !== '' && node.fillStyleId !== figma.mixed) {
              hasBoundFill = true;
            }
          } catch (e2) {}

          if (hasBoundFill) {
            stats.boundFills++;
          } else {
            stats.unboundFills++;
            if (issues.length < MCP_MAX_ISSUES_PER_CATEGORY) {
              issues.push({
                id: node.id,
                name: node.name,
                type: node.type,
                path: nodePath(node),
                rule: 'unbound-fill',
                message: 'Solid fill not using a variable or style',
                color: fill.color ? rgbToHex(fill.color.r, fill.color.g, fill.color.b) : '#???',
                tooltip: 'AI will hardcode this hex value instead of referencing a design token.'
              });
            }
          }
          break; // one fill check per node
        }
      }
    } catch (e) {}

    // Check strokes
    try {
      if (node.strokes && Array.isArray(node.strokes)) {
        for (var j = 0; j < node.strokes.length; j++) {
          var stroke = node.strokes[j];
          if (stroke.type !== 'SOLID') continue;
          if (stroke.visible === false) continue;

          var hasBoundStroke = false;
          try {
            if (node.boundVariables && node.boundVariables.strokes) {
              hasBoundStroke = true;
            }
            if (!hasBoundStroke && node.strokeStyleId && node.strokeStyleId !== '' && node.strokeStyleId !== figma.mixed) {
              hasBoundStroke = true;
            }
          } catch (e3) {}

          if (hasBoundStroke) {
            stats.boundStrokes++;
          } else {
            stats.unboundStrokes++;
            if (issues.length < MCP_MAX_ISSUES_PER_CATEGORY) {
              issues.push({
                id: node.id,
                name: node.name,
                type: node.type,
                path: nodePath(node),
                rule: 'unbound-stroke',
                message: 'Stroke not using a variable or style',
                color: stroke.color ? rgbToHex(stroke.color.r, stroke.color.g, stroke.color.b) : '#???',
                tooltip: 'AI will hardcode this border color instead of using a token.'
              });
            }
          }
          break; // one stroke check per node
        }
      }
    } catch (e) {}

    // Check text styles (NEW)
    if (node.type === 'TEXT') {
      try {
        var tsId = node.textStyleId;
        if (tsId && tsId !== '' && tsId !== figma.mixed) {
          stats.boundText++;
        } else {
          stats.unboundText++;
          if (issues.length < MCP_MAX_ISSUES_PER_CATEGORY) {
            issues.push({
              id: node.id,
              name: node.name,
              type: node.type,
              path: nodePath(node),
              rule: 'unbound-text-style',
              message: 'Text not using a shared text style',
              tooltip: 'AI will hardcode font-size, weight, and line-height instead of referencing a typography token.'
            });
          }
        }
      } catch (e) {
        // textStyleId not available — count as unbound
        stats.unboundText++;
      }
    }

    // Check effect styles (NEW)
    try {
      if (node.effects && Array.isArray(node.effects) && node.effects.length > 0) {
        var hasVisibleEffect = false;
        for (var k = 0; k < node.effects.length; k++) {
          if (node.effects[k].visible !== false) { hasVisibleEffect = true; break; }
        }
        if (hasVisibleEffect) {
          var esId = node.effectStyleId;
          if (esId && esId !== '' && esId !== figma.mixed) {
            stats.boundEffects++;
          } else {
            stats.unboundEffects++;
            if (issues.length < MCP_MAX_ISSUES_PER_CATEGORY) {
              issues.push({
                id: node.id,
                name: node.name,
                type: node.type,
                path: nodePath(node),
                rule: 'unbound-effect',
                message: 'Effect (shadow/blur) not using an effect style',
                tooltip: 'AI will hardcode shadow values instead of using an elevation/shadow token.'
              });
            }
          }
        }
      }
    } catch (e) {}
  });

  return { issues: issues, stats: stats };
}

function checkMcpAutoLayout(root) {
  var issues = [];
  var stats = { withAL: 0, withoutAL: 0 };

  walk(root, function(node) {
    if (node.type === 'PAGE') return;
    if (isInsideInstance(node)) return;
    if (issues.length >= MCP_MAX_ISSUES_PER_CATEGORY) return;

    // Frames with 2+ children without auto layout
    if (node.type === 'FRAME' && 'children' in node && node.children.length >= 2) {
      var hasAL = node.layoutMode && node.layoutMode !== 'NONE';
      if (hasAL) {
        stats.withAL++;
      } else {
        stats.withoutAL++;
        issues.push({
          id: node.id,
          name: node.name,
          type: node.type,
          path: nodePath(node),
          rule: 'no-auto-layout',
          message: 'Frame with ' + node.children.length + ' children has no Auto Layout',
          tooltip: 'Without Auto Layout, AI cannot determine flex direction or spacing and will guess absolute positions.'
        });
      }
    }

    // Components without auto layout (Figma best practice: components should use AL)
    if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && 'children' in node && node.children.length >= 2) {
      var compHasAL = node.layoutMode && node.layoutMode !== 'NONE';
      // Don't double-count if already caught as FRAME above
      if (node.type === 'COMPONENT' && !compHasAL) {
        // Components already counted in FRAME block since they extend FRAME
      }
    }

    // Groups should be frames (lowered threshold from 3 to 2)
    if (node.type === 'GROUP' && 'children' in node && node.children.length >= 2) {
      issues.push({
        id: node.id,
        name: node.name,
        type: node.type,
        path: nodePath(node),
        rule: 'group-should-be-frame',
        message: 'Group with ' + node.children.length + ' children — convert to Frame with Auto Layout',
        tooltip: 'Groups have no layout semantics. AI cannot determine if children are horizontal, vertical, or overlapping.'
      });
    }

    // Absolute positioning inside auto-layout parent
    try {
      if (node.layoutPositioning === 'ABSOLUTE' && node.parent &&
          node.parent.layoutMode && node.parent.layoutMode !== 'NONE') {
        issues.push({
          id: node.id,
          name: node.name,
          type: node.type,
          path: nodePath(node),
          rule: 'absolute-in-autolayout',
          message: 'Absolute positioning inside Auto Layout parent',
          tooltip: 'Mixing absolute and flex positioning confuses AI — it cannot determine which layout system to use.'
        });
      }
    } catch (e) {}
  });

  return { issues: issues, stats: stats };
}

function checkMcpStructure(root) {
  var issues = [];

  walk(root, function(node) {
    if (node.type === 'PAGE') return;
    if (issues.length >= MCP_MAX_ISSUES_PER_CATEGORY) return;

    // Deep nesting inside components (>5 levels)
    if (node.type !== 'PAGE' && node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') {
      var depth = 0;
      var current = node.parent;
      var foundComponent = false;
      while (current && current.type !== 'PAGE' && depth < MCP_MAX_DEPTH) {
        depth++;
        if (current.type === 'COMPONENT' || current.type === 'COMPONENT_SET') {
          foundComponent = true;
          break;
        }
        current = current.parent;
      }

      if (foundComponent && depth > 5) {
        issues.push({
          id: node.id,
          name: node.name,
          type: node.type,
          path: nodePath(node),
          rule: 'deep-nesting',
          message: 'Nested ' + depth + ' levels deep inside component',
          tooltip: 'Deep nesting produces deeply nested code that is hard to read and maintain.'
        });
      }
    }

    // Component Set with only 1 variant
    if (node.type === 'COMPONENT_SET' && 'children' in node && node.children.length === 1) {
      issues.push({
        id: node.id,
        name: node.name,
        type: node.type,
        path: nodePath(node),
        rule: 'single-variant',
        message: 'Component Set has only 1 variant — unnecessary wrapper',
        tooltip: 'Single-variant sets add complexity without benefit. AI generates extra branching code for no reason.'
      });
    }

    // Detached instances (NEW — frames that were once instances)
    try {
      if (node.type === 'FRAME' && node.detachedInfo) {
        issues.push({
          id: node.id,
          name: node.name,
          type: node.type,
          path: nodePath(node),
          rule: 'detached-instance',
          message: 'Detached instance — lost link to component',
          tooltip: 'Detached instances lose component reuse. AI will generate duplicate code instead of shared components.'
        });
      }
    } catch (e) {} // detachedInfo may not exist on older API versions

    // Complex nodes — 10+ children with 4+ different types
    if ('children' in node && node.children.length > 10 && node.type !== 'PAGE') {
      var types = {};
      for (var i = 0; i < node.children.length; i++) {
        types[node.children[i].type] = true;
      }
      var typeCount = Object.keys(types).length;
      if (typeCount >= 4) {
        issues.push({
          id: node.id,
          name: node.name,
          type: node.type,
          path: nodePath(node),
          rule: 'complex-node',
          message: node.children.length + ' children, ' + typeCount + ' types — break into smaller components',
          tooltip: 'Complex nodes produce monolithic code blocks. Smaller components generate cleaner, reusable code.'
        });
      }
    }
  });

  return issues;
}

function checkMcpSpacing(root) {
  var issues = [];
  var stats = { onGrid: 0, offGrid: 0 };

  walk(root, function(node) {
    if (node.type === 'PAGE') return;
    if (isInsideInstance(node)) return;
    if (!node.layoutMode || node.layoutMode === 'NONE') return;
    if (issues.length >= MCP_MAX_ISSUES_PER_CATEGORY) return;

    var nodeOnGrid = true;

    // Check itemSpacing
    var spacing = node.itemSpacing;
    if (typeof spacing === 'number' && spacing > 0 && spacing % 4 !== 0) {
      nodeOnGrid = false;
      issues.push({
        id: node.id,
        name: node.name,
        type: node.type,
        path: nodePath(node),
        rule: 'off-grid-spacing',
        message: 'Gap ' + spacing + 'px not on 4px grid (use ' + (Math.round(spacing / 4) * 4) + ')',
        value: spacing,
        tooltip: 'Standard spacing tokens use 4px increments (4, 8, 12, 16, 20, 24...). Off-grid values produce magic numbers in code.'
      });
    }

    // Check paddings
    var paddings = [
      { val: node.paddingTop, label: 'Top' },
      { val: node.paddingRight, label: 'Right' },
      { val: node.paddingBottom, label: 'Bottom' },
      { val: node.paddingLeft, label: 'Left' }
    ];
    for (var j = 0; j < paddings.length; j++) {
      var p = paddings[j].val;
      if (typeof p === 'number' && p > 0 && p % 4 !== 0) {
        nodeOnGrid = false;
        issues.push({
          id: node.id,
          name: node.name,
          type: node.type,
          path: nodePath(node),
          rule: 'off-grid-padding',
          message: 'Padding ' + paddings[j].label + ' ' + p + 'px not on 4px grid',
          value: p,
          tooltip: 'Off-grid padding produces hardcoded values instead of clean spacing tokens.'
        });
        break; // one padding issue per node
      }
    }

    if (nodeOnGrid) {
      stats.onGrid++;
    } else {
      stats.offGrid++;
    }
  });

  return { issues: issues, stats: stats };
}

function checkMcpReadability(root) {
  var issues = [];

  walk(root, function(node) {
    if (node.type === 'PAGE') return;
    if (isInsideInstance(node)) return;
    if (issues.length >= MCP_MAX_ISSUES_PER_CATEGORY) return;

    // Hidden layers with non-default names (MCP tools may still read these)
    if (node.visible === false && !UNNAMED_PATTERN.test(node.name)) {
      issues.push({
        id: node.id,
        name: node.name,
        type: node.type,
        path: nodePath(node),
        rule: 'hidden-layer',
        message: 'Hidden layer — AI may generate invisible code for this',
        tooltip: 'MCP tools read hidden layers too. AI might generate code for elements the user will never see.'
      });
    }

    // Empty containers — FRAME or GROUP with 0 children
    if ((node.type === 'FRAME' || node.type === 'GROUP') && 'children' in node && node.children.length === 0) {
      issues.push({
        id: node.id,
        name: node.name,
        type: node.type,
        path: nodePath(node),
        rule: 'empty-container',
        message: 'Empty container — generates an empty wrapper in code',
        tooltip: 'Empty frames/groups produce empty View/div wrappers with no content.'
      });
    }
  });

  return issues;
}

function checkStateCoverage(root) {
  if (!root) root = figma.currentPage;
  var variantsByParent = {};

  walk(root, function(node) {
    if (node.type === 'PAGE') return;
    if (node.type === 'FRAME' || node.type === 'COMPONENT') {
      var stateMatch = node.name.match(/State\s*=\s*([^,]+)/i);
      if (stateMatch) {
        var parentId = node.parent ? node.parent.id : 'root';
        var parentName = node.parent ? node.parent.name : 'Page';
        if (!variantsByParent[parentId]) {
          variantsByParent[parentId] = {
            parentName: parentName,
            parentId: parentId,
            states: [],
            componentName: '',
            sampleNodeId: node.id
          };
        }
        var stateName = stateMatch[1].trim();
        if (variantsByParent[parentId].states.indexOf(stateName) === -1) {
          variantsByParent[parentId].states.push(stateName);
        }
        if (!variantsByParent[parentId].componentName) {
          variantsByParent[parentId].componentName = parentName;
        }
      }
    }
  });

  var missingStates = [];
  var parentIds = Object.keys(variantsByParent);
  for (var vi = 0; vi < parentIds.length; vi++) {
    var group = variantsByParent[parentIds[vi]];
    var compNameLower = group.componentName.toLowerCase();
    var expectedKeys = Object.keys(EXPECTED_STATES);
    var matchedType = null;

    for (var ei = 0; ei < expectedKeys.length; ei++) {
      if (compNameLower.includes(expectedKeys[ei])) {
        matchedType = expectedKeys[ei];
        break;
      }
    }

    if (matchedType) {
      var expected = EXPECTED_STATES[matchedType];
      var missing = [];
      for (var si = 0; si < expected.length; si++) {
        var found = false;
        for (var gi = 0; gi < group.states.length; gi++) {
          if (group.states[gi].toLowerCase() === expected[si].toLowerCase()) {
            found = true;
            break;
          }
        }
        if (!found) missing.push(expected[si]);
      }

      missingStates.push({
        parentId: group.parentId,
        parentName: group.parentName,
        componentName: group.componentName,
        componentType: matchedType,
        existingStates: group.states,
        missingStates: missing,
        sampleNodeId: group.sampleNodeId
      });
    }
  }

  return missingStates;
}

function mcpReadyAudit(root) {
  if (!root) root = figma.currentPage;
  // Run all MCP-focused checks
  var namingIssues = checkMcpNaming(root);
  var tokenResult = checkMcpTokenBinding(root);
  var layoutResult = checkMcpAutoLayout(root);
  var structureIssues = checkMcpStructure(root);
  var spacingResult = checkMcpSpacing(root);
  var readabilityIssues = checkMcpReadability(root);

  // ── Category A: Layer Naming (25 pts, count-based) ──
  var namingDeduction = Math.min(namingIssues.length * 2, 25);

  // ── Category B: Token Binding (25 pts, percentage-based) ──
  var ts = tokenResult.stats;
  var totalBindable = ts.boundFills + ts.unboundFills + ts.boundStrokes + ts.unboundStrokes +
                      ts.boundText + ts.unboundText + ts.boundEffects + ts.unboundEffects;
  var totalBound = ts.boundFills + ts.boundStrokes + ts.boundText + ts.boundEffects;
  var bindingPct = totalBindable > 0 ? Math.round((totalBound / totalBindable) * 100) : 100;
  var tokenDeduction = Math.round((100 - bindingPct) * 0.25);

  // ── Category C: Auto Layout (20 pts, percentage + extras) ──
  var als = layoutResult.stats;
  var totalFrames = als.withAL + als.withoutAL;
  var alPct = totalFrames > 0 ? Math.round((als.withAL / totalFrames) * 100) : 100;
  var groupCount = 0;
  var absCount = 0;
  for (var li = 0; li < layoutResult.issues.length; li++) {
    if (layoutResult.issues[li].rule === 'group-should-be-frame') groupCount++;
    if (layoutResult.issues[li].rule === 'absolute-in-autolayout') absCount++;
  }
  var layoutDeduction = Math.min(Math.round((100 - alPct) * 0.20) + groupCount * 0.5 + absCount * 0.5, 20);

  // ── Category D: Component Structure (15 pts, weighted count) ──
  var detachedCount = 0, complexCount = 0, otherStructCount = 0;
  for (var si = 0; si < structureIssues.length; si++) {
    var sr = structureIssues[si].rule;
    if (sr === 'detached-instance') detachedCount++;
    else if (sr === 'complex-node') complexCount++;
    else otherStructCount++;
  }
  var structureDeduction = Math.min(detachedCount * 2 + complexCount * 1.5 + otherStructCount * 1, 15);

  // ── Category E: Spacing Consistency (10 pts, percentage-based) ──
  var sps = spacingResult.stats;
  var totalSpacingNodes = sps.onGrid + sps.offGrid;
  var gridPct = totalSpacingNodes > 0 ? Math.round((sps.onGrid / totalSpacingNodes) * 100) : 100;
  var spacingDeduction = Math.round((100 - gridPct) * 0.10);

  // ── Category F: Semantic Readability (5 pts, count-based) ──
  var readabilityDeduction = Math.min(readabilityIssues.length * 0.5, 5);

  // ── Final Score ──
  var totalDeduction = namingDeduction + tokenDeduction + layoutDeduction +
                       structureDeduction + spacingDeduction + readabilityDeduction;
  var score = Math.max(0, Math.round(100 - totalDeduction));
  var totalIssues = namingIssues.length + tokenResult.issues.length + layoutResult.issues.length +
                    structureIssues.length + spacingResult.issues.length + readabilityIssues.length;

  // Phase 1 features — wire existing functions
  var states = checkStateCoverage(root);
  var navigation = analyzeNavigation();
  var assets = auditAssets();

  return {
    naming:      { issues: namingIssues, deduction: Math.round(namingDeduction), max: 25 },
    tokens:      { issues: tokenResult.issues, deduction: Math.round(tokenDeduction), max: 25,
                   stats: { bound: totalBound, total: totalBindable, pct: bindingPct } },
    layout:      { issues: layoutResult.issues, deduction: Math.round(layoutDeduction), max: 20,
                   stats: { withAL: als.withAL, total: totalFrames, pct: alPct } },
    structure:   { issues: structureIssues, deduction: Math.round(structureDeduction), max: 15 },
    spacing:     { issues: spacingResult.issues, deduction: Math.round(spacingDeduction), max: 10,
                   stats: { onGrid: sps.onGrid, total: totalSpacingNodes, pct: gridPct } },
    readability: { issues: readabilityIssues, deduction: Math.round(readabilityDeduction), max: 5 },
    states: states,
    navigation: navigation,
    assets: assets,
    score: score,
    totalIssues: totalIssues
  };
}


// ═══════════════════════════════════════════════════════════
// MCP READY: ONE-CLICK FIX
// ═══════════════════════════════════════════════════════════

function findClosestPaintStyle(color, paintStyles) {
  var closest = null;
  var closestDist = Infinity;
  for (var i = 0; i < paintStyles.length; i++) {
    var ps = paintStyles[i];
    try {
      var paints = ps.paints;
      if (!paints || paints.length === 0 || paints[0].type !== 'SOLID') continue;
      var c = paints[0].color;
      var dist = Math.sqrt(
        Math.pow(color.r - c.r, 2) +
        Math.pow(color.g - c.g, 2) +
        Math.pow(color.b - c.b, 2)
      );
      if (dist < closestDist) {
        closestDist = dist;
        closest = ps;
      }
    } catch (e) {}
  }
  if (closestDist > 0.2) return null;
  return closest;
}

function fixMcpNaming(root) {
  if (!root) root = figma.currentPage;
  var mappings = [];
  walk(root, function(node) {
    if (node.type === 'PAGE') return;
    if (mappings.length >= MCP_MAX_ISSUES_PER_CATEGORY) return;
    if (UNNAMED_PATTERN.test(node.name)) {
      mappings.push({ id: node.id, newName: suggestName(node) });
    }
  });
  return batchRename(mappings).then(function(result) {
    return { fixed: result.renamed, skipped: 0, errors: result.errors };
  });
}

function fixMcpAutoLayout(root) {
  if (!root) root = figma.currentPage;
  var nodeIds = [];
  walk(root, function(node) {
    if (node.type === 'PAGE') return;
    if (isInsideInstance(node)) return;
    if (nodeIds.length >= MCP_MAX_ISSUES_PER_CATEGORY) return;
    if (node.type === 'FRAME' && 'children' in node && node.children.length >= 2) {
      if (!node.layoutMode || node.layoutMode === 'NONE') {
        nodeIds.push(node.id);
      }
    }
  });
  return applyAutoLayout(nodeIds, null, null, null).then(function(result) {
    return { fixed: result.applied, skipped: 0, errors: result.errors };
  });
}

function fixMcpTokenBinding(root) {
  if (!root) root = figma.currentPage;
  return figma.getLocalPaintStylesAsync().then(function(paintStyles) {
    var fixed = 0;
    var skipped = 0;
    var errors = [];
    var batch = [];

    walk(root, function(node) {
      if (node.type === 'PAGE') return;
      if (isInsideInstance(node)) return;
      if (batch.length >= MCP_MAX_ISSUES_PER_CATEGORY) return;

      try {
        if (node.fills && Array.isArray(node.fills)) {
          for (var i = 0; i < node.fills.length; i++) {
            var fill = node.fills[i];
            if (fill.type !== 'SOLID') continue;
            if (fill.visible === false) continue;
            if (fill.color && isNearWhite(fill.color) && (node.type === 'FRAME' || node.type === 'GROUP')) continue;

            var hasBound = false;
            try {
              if (node.boundVariables && node.boundVariables.fills) hasBound = true;
              if (!hasBound && node.fillStyleId && node.fillStyleId !== '' && node.fillStyleId !== figma.mixed) hasBound = true;
            } catch (e2) {}

            if (!hasBound && fill.color) {
              batch.push({ node: node, color: fill.color });
            }
            break;
          }
        }
      } catch (e) {}
    });

    for (var bi = 0; bi < batch.length; bi++) {
      var item = batch[bi];
      var style = findClosestPaintStyle(item.color, paintStyles);
      if (style) {
        try {
          item.node.fillStyleId = style.id;
          fixed++;
        } catch (e) {
          errors.push(item.node.id);
        }
      } else {
        skipped++;
      }
    }

    return { fixed: fixed, skipped: skipped, errors: errors };
  });
}

function fixMcpSpacing(root) {
  if (!root) root = figma.currentPage;
  var fixed = 0;
  var errors = [];

  walk(root, function(node) {
    if (node.type === 'PAGE') return;
    if (isInsideInstance(node)) return;
    if (!node.layoutMode || node.layoutMode === 'NONE') return;

    try {
      // Snap itemSpacing to nearest 4px
      var spacing = node.itemSpacing;
      if (typeof spacing === 'number' && spacing > 0 && spacing % 4 !== 0) {
        node.itemSpacing = Math.round(spacing / 4) * 4;
        fixed++;
      }

      // Snap paddings to nearest 4px
      var sides = ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft'];
      for (var i = 0; i < sides.length; i++) {
        var val = node[sides[i]];
        if (typeof val === 'number' && val > 0 && val % 4 !== 0) {
          node[sides[i]] = Math.round(val / 4) * 4;
          fixed++;
        }
      }
    } catch (e) {
      errors.push(node.id);
    }
  });

  return Promise.resolve({ fixed: fixed, skipped: 0, errors: errors });
}

function fixMcpAll(root) {
  if (!root) root = figma.currentPage;
  var results = { naming: null, layout: null, tokens: null, spacing: null };
  return fixMcpNaming(root).then(function(namingResult) {
    results.naming = namingResult;
    return fixMcpAutoLayout(root);
  }).then(function(layoutResult) {
    results.layout = layoutResult;
    return fixMcpTokenBinding(root);
  }).then(function(tokenResult) {
    results.tokens = tokenResult;
    return fixMcpSpacing(root);
  }).then(function(spacingResult) {
    results.spacing = spacingResult;
    return results;
  });
}

// ═══════════════════════════════════════════════════════════
// MCP READY: COMPONENT INTENT MAPPING
// ═══════════════════════════════════════════════════════════

var INTENT_OPTIONS = [
  'View', 'Text', 'TextInput', 'Image', 'FlatList', 'ScrollView',
  'TouchableOpacity', 'Pressable', 'Button', 'Switch', 'Modal',
  'SafeAreaView', 'KeyboardAvoidingView', 'ActivityIndicator'
];

function setNodeIntent(nodeId, intent) {
  return figma.getNodeByIdAsync(nodeId).then(function(node) {
    if (!node) return { success: false, error: 'Node not found' };
    node.setPluginData('mcp-intent', intent);
    return { success: true };
  });
}

function autoDetectIntents(root) {
  if (!root) root = figma.currentPage;
  var results = [];
  var rnKeys = Object.keys(RN_COMPONENT_MAP);

  walk(root, function(node) {
    if (node.type === 'PAGE') return;
    if (results.length >= MCP_MAX_ISSUES_PER_CATEGORY) return;

    var isTarget = node.type === 'COMPONENT' || node.type === 'COMPONENT_SET' ||
                   node.type === 'INSTANCE' ||
                   (node.type === 'FRAME' && node.parent && node.parent.type === 'PAGE');
    if (!isTarget) return;

    // Don't overwrite existing intents
    try {
      var existing = node.getPluginData('mcp-intent');
      if (existing && existing !== '') return;
    } catch (e) {}

    var nameLower = node.name.toLowerCase();
    var matched = null;
    var matchedKey = '';
    var confidence = 'low';

    // Try mainComponent name for instances
    if (node.type === 'INSTANCE') {
      try {
        var main = node.mainComponent;
        if (main && main.name) {
          nameLower = main.name.toLowerCase();
          confidence = 'high';
        }
      } catch (e) {}
    }

    for (var k = 0; k < rnKeys.length; k++) {
      if (nameLower.indexOf(rnKeys[k]) !== -1) {
        matched = RN_COMPONENT_MAP[rnKeys[k]];
        matchedKey = rnKeys[k];
        if (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') confidence = 'high';
        else if (confidence !== 'high') confidence = 'medium';
        break;
      }
    }

    if (matched) {
      results.push({
        id: node.id,
        name: node.name,
        path: nodePath(node),
        type: node.type,
        intent: matched.rnComponent,
        matchedKey: matchedKey,
        confidence: confidence
      });
    }
  });

  return results;
}

function batchSetIntents(mappings) {
  var applied = 0;
  var errors = [];
  var promises = [];
  for (var i = 0; i < mappings.length; i++) {
    (function(m) {
      promises.push(
        figma.getNodeByIdAsync(m.id).then(function(node) {
          if (node) {
            node.setPluginData('mcp-intent', m.intent);
            applied++;
          } else {
            errors.push(m.id);
          }
        }).catch(function() { errors.push(m.id); })
      );
    })(mappings[i]);
  }
  return Promise.all(promises).then(function() {
    return { applied: applied, errors: errors };
  });
}

function collectIntentAnnotations(root) {
  if (!root) root = figma.currentPage;
  var results = [];
  walk(root, function(node) {
    if (node.type === 'PAGE') return;
    try {
      var intent = node.getPluginData('mcp-intent');
      if (intent && intent !== '') {
        results.push({
          id: node.id,
          name: node.name,
          path: nodePath(node),
          type: node.type,
          intent: intent
        });
      }
    } catch (e) {}
  });
  return results;
}

// ═══════════════════════════════════════════════════════════
// MCP READY: RESPONSIVE BEHAVIOR ANNOTATIONS
// ═══════════════════════════════════════════════════════════

function setResponsiveHint(nodeId, hints) {
  return figma.getNodeByIdAsync(nodeId).then(function(node) {
    if (!node) return { success: false, error: 'Node not found' };
    node.setPluginData('mcp-responsive', JSON.stringify(hints));
    return { success: true };
  });
}

function clearResponsiveHint(nodeId) {
  return figma.getNodeByIdAsync(nodeId).then(function(node) {
    if (!node) return { success: false, error: 'Node not found' };
    node.setPluginData('mcp-responsive', '');
    return { success: true };
  });
}

function collectResponsiveAnnotations(root) {
  if (!root) root = figma.currentPage;
  var results = [];
  walk(root, function(node) {
    if (node.type === 'PAGE') return;
    try {
      var data = node.getPluginData('mcp-responsive');
      if (data && data !== '') {
        var hints = JSON.parse(data);
        results.push({
          id: node.id,
          name: node.name,
          path: nodePath(node),
          type: node.type,
          hints: hints
        });
      }
    } catch (e) {}
  });
  return results;
}

// ═══════════════════════════════════════════════════════════
// MCP READY: PROMPT GENERATOR
// ═══════════════════════════════════════════════════════════

function serializeScreenTree(root, maxDepth) {
  if (!maxDepth) maxDepth = 8;
  var lines = [];
  var totalChars = 0;
  var MAX_CHARS = 80000;

  function walkTree(node, depth) {
    if (totalChars > MAX_CHARS) return;
    if (depth > maxDepth) return;

    // Handle PAGE and VIRTUAL root nodes
    if (node.type === 'PAGE' || node.type === 'VIRTUAL') {
      if ('children' in node) {
        for (var i = 0; i < node.children.length; i++) {
          var child = node.children[i];
          if (child.type === 'FRAME' || child.type === 'COMPONENT' || child.type === 'COMPONENT_SET') {
            walkTree(child, depth);
          }
        }
      }
      return;
    }

    // Skip hidden layers
    if (node.visible === false) return;

    var indent = '';
    for (var p = 0; p < depth; p++) indent += '  ';

    var parts = [node.name + ' (' + node.type + ')'];

    // Figma node ID for MCP tool inspection
    parts.push('#' + node.id);

    // Opacity
    try {
      if (typeof node.opacity === 'number' && node.opacity < 1) {
        parts.push('opacity:' + Math.round(node.opacity * 100) / 100);
      }
    } catch (e) {}

    // Dimensions for top-level screens/components
    var w = Math.round(node.width);
    var h = Math.round(node.height);
    if (depth === 0) {
      parts.push(w + 'x' + h);
    }

    // Auto Layout → flexbox mapping
    if (node.layoutMode && node.layoutMode !== 'NONE') {
      var dir = node.layoutMode === 'HORIZONTAL' ? 'row' : 'column';
      var layoutParts = ['flex:' + dir];

      if (node.itemSpacing) layoutParts.push('gap:' + node.itemSpacing);

      // Padding — compact notation
      var pt = node.paddingTop || 0;
      var pr2 = node.paddingRight || 0;
      var pb = node.paddingBottom || 0;
      var pl = node.paddingLeft || 0;
      if (pt || pr2 || pb || pl) {
        if (pt === pr2 && pr2 === pb && pb === pl) {
          layoutParts.push('p:' + pt);
        } else if (pt === pb && pl === pr2) {
          layoutParts.push('py:' + pt + ',px:' + pl);
        } else {
          layoutParts.push('p:' + pt + ',' + pr2 + ',' + pb + ',' + pl);
        }
      }

      // Alignment → justifyContent / alignItems
      var mainAlign = node.primaryAxisAlignItems;
      var crossAlign = node.counterAxisAlignItems;
      if (mainAlign && mainAlign !== 'MIN') {
        var justifyMap = { CENTER: 'center', MAX: 'flex-end', SPACE_BETWEEN: 'space-between' };
        layoutParts.push('justify:' + (justifyMap[mainAlign] || mainAlign.toLowerCase()));
      }
      if (crossAlign && crossAlign !== 'MIN') {
        var alignMap = { CENTER: 'center', MAX: 'flex-end', BASELINE: 'baseline' };
        layoutParts.push('align:' + (alignMap[crossAlign] || crossAlign.toLowerCase()));
      }

      parts.push('[' + layoutParts.join(', ') + ']');
    }

    // Sizing mode → flex:1 / fixed / hug
    try {
      var hSizing = node.layoutSizingHorizontal;
      var vSizing = node.layoutSizingVertical;
      if (hSizing === 'FILL') parts.push('w:fill');
      else if (hSizing === 'FIXED' && depth > 0) parts.push('w:' + w);
      if (vSizing === 'FILL') parts.push('h:fill');
      else if (vSizing === 'FIXED' && depth > 0) parts.push('h:' + h);
    } catch (e) {}

    // Border radius → borderRadius (supports mixed corners)
    try {
      var br = node.cornerRadius;
      if (br === figma.mixed) {
        var tl = node.topLeftRadius || 0;
        var tr2 = node.topRightRadius || 0;
        var brr = node.bottomRightRadius || 0;
        var bl = node.bottomLeftRadius || 0;
        if (tl || tr2 || brr || bl) {
          parts.push('r:' + tl + ',' + tr2 + ',' + brr + ',' + bl);
        }
      } else if (typeof br === 'number' && br > 0) {
        parts.push('r:' + br);
      }
    } catch (e) {}

    // Fill color (with opacity + gradient details)
    try {
      if (node.fills && Array.isArray(node.fills) && node.fills.length > 0) {
        var fill = node.fills[0];
        if (fill.type === 'SOLID' && fill.visible !== false && fill.color) {
          var hex = rgbToHex(fill.color.r, fill.color.g, fill.color.b);
          if (!isNearWhite(fill.color) || node.type === 'RECTANGLE' || node.type === 'ELLIPSE' || node.type === 'COMPONENT') {
            var fillOpacity = typeof fill.opacity === 'number' && fill.opacity < 1 ? fill.opacity : null;
            if (fillOpacity !== null) {
              parts.push('bg:' + hex + '/' + (Math.round(fillOpacity * 100) / 100));
            } else {
              parts.push('bg:' + hex);
            }
          }
        } else if (fill.type === 'GRADIENT_LINEAR' && fill.visible !== false) {
          try {
            var gt = fill.gradientTransform;
            var angle = gt ? Math.round(Math.atan2(gt[0][1], gt[0][0]) * 180 / Math.PI + 90) : 180;
            if (angle < 0) angle += 360;
            var stops = fill.gradientStops;
            var stopParts = [];
            if (stops && stops.length > 0) {
              for (var gi = 0; gi < stops.length; gi++) {
                var gs = stops[gi];
                var stopHex = rgbToHex(gs.color.r, gs.color.g, gs.color.b);
                var alpha = typeof gs.color.a === 'number' ? Math.round(gs.color.a * 255) : 255;
                var alphaHex = alpha < 255 ? ('0' + alpha.toString(16)).slice(-2).toUpperCase() : '';
                var pos = Math.round(gs.position * 100);
                stopParts.push(stopHex + alphaHex + '@' + pos + '%');
              }
            }
            parts.push('bg:linear-gradient(' + angle + 'deg,' + stopParts.join(',') + ')');
          } catch (ge) {
            parts.push('bg:linear-gradient');
          }
        }
      }
    } catch (e) {}

    // Shadow → elevation / boxShadow (with color + spread)
    try {
      if (node.effects && Array.isArray(node.effects)) {
        for (var ei = 0; ei < node.effects.length; ei++) {
          var eff = node.effects[ei];
          if (eff.type === 'DROP_SHADOW' && eff.visible !== false) {
            var ox = eff.offset ? eff.offset.x : 0;
            var oy = eff.offset ? eff.offset.y : 0;
            var shadowColor = '#00000040';
            if (eff.color) {
              var sr = Math.round(eff.color.r * 255);
              var sg = Math.round(eff.color.g * 255);
              var sb = Math.round(eff.color.b * 255);
              var sa = typeof eff.color.a === 'number' ? Math.round(eff.color.a * 255) : 255;
              shadowColor = '#' + ('0' + sr.toString(16)).slice(-2) + ('0' + sg.toString(16)).slice(-2) + ('0' + sb.toString(16)).slice(-2) + (sa < 255 ? ('0' + sa.toString(16)).slice(-2) : '');
            }
            var spread = eff.spread || 0;
            if (spread) {
              parts.push('shadow:' + ox + ',' + oy + ',' + (eff.radius || 0) + ',' + spread + ',' + shadowColor);
            } else {
              parts.push('shadow:' + ox + ',' + oy + ',' + (eff.radius || 0) + ',' + shadowColor);
            }
            break;
          }
        }
      }
    } catch (e) {}

    // Stroke / border
    try {
      if (node.strokes && Array.isArray(node.strokes) && node.strokes.length > 0) {
        var stroke = node.strokes[0];
        if (stroke.type === 'SOLID' && stroke.visible !== false) {
          var sw = node.strokeWeight || 1;
          var sc = stroke.color ? rgbToHex(stroke.color.r, stroke.color.g, stroke.color.b) : '#000';
          parts.push('border:' + sw + ',' + sc);
        }
      }
    } catch (e) {}

    // TEXT node — full typography data
    if (node.type === 'TEXT') {
      try {
        var txt = node.characters;
        if (typeof txt === 'string' && txt.length > 0) {
          var truncated = txt.length > 60 ? txt.substring(0, 60) + '...' : txt;
          parts.push('"' + truncated.replace(/\n/g, '\\n') + '"');
        }
        var fs = node.fontSize;
        if (typeof fs === 'number') {
          var textParts = [fs + 'px'];
          try {
            var fontName = node.fontName;
            if (fontName && typeof fontName === 'object' && fontName.style) {
              var style = fontName.style;
              if (style !== 'Regular') textParts.push(style);
            }
          } catch (e2) {}
          var lh = node.lineHeight;
          if (lh && typeof lh === 'object') {
            if (lh.unit === 'PIXELS') textParts.push('lh:' + Math.round(lh.value));
            else if (lh.unit === 'PERCENT') textParts.push('lh:' + Math.round(lh.value) + '%');
            else if (lh.unit === 'AUTO') textParts.push('lh:auto');
          }
          parts.push('font:' + textParts.join(','));
        }
        // Letter spacing
        try {
          var ls = node.letterSpacing;
          if (ls && typeof ls === 'object' && ls.value) {
            if (ls.unit === 'PIXELS') parts.push('ls:' + (Math.round(ls.value * 10) / 10));
            else if (ls.unit === 'PERCENT') parts.push('ls:' + Math.round(ls.value) + '%');
          }
        } catch (e4) {}
        // Text decoration
        try {
          var td = node.textDecoration;
          if (td === 'UNDERLINE') parts.push('underline');
          else if (td === 'STRIKETHROUGH') parts.push('strikethrough');
        } catch (e5) {}
        // Text case
        try {
          var tc = node.textCase;
          if (tc === 'UPPER') parts.push('uppercase');
          else if (tc === 'LOWER') parts.push('lowercase');
          else if (tc === 'TITLE') parts.push('capitalize');
        } catch (e6) {}
        // Text color
        if (node.fills && Array.isArray(node.fills) && node.fills.length > 0) {
          var tFill = node.fills[0];
          if (tFill.type === 'SOLID' && tFill.color) {
            parts.push('color:' + rgbToHex(tFill.color.r, tFill.color.g, tFill.color.b));
          }
        }
        // Text alignment
        try {
          var ta = node.textAlignHorizontal;
          if (ta && ta !== 'LEFT') parts.push('textAlign:' + ta.toLowerCase());
        } catch (e3) {}
      } catch (e) {}
    }

    // INSTANCE — reference to main component
    if (node.type === 'INSTANCE') {
      try {
        var main = node.mainComponent;
        if (main) parts.push('component:' + main.name);
      } catch (e) {}
    }

    // COMPONENT — variant properties
    if (node.type === 'COMPONENT_SET') {
      try {
        if (node.componentPropertyDefinitions) {
          var propKeys = Object.keys(node.componentPropertyDefinitions);
          if (propKeys.length > 0) {
            parts.push('props:[' + propKeys.join(',') + ']');
          }
        }
      } catch (e) {}
    }

    // Image fill indicator
    try {
      if (node.fills && Array.isArray(node.fills)) {
        for (var fi = 0; fi < node.fills.length; fi++) {
          if (node.fills[fi].type === 'IMAGE') {
            parts.push('hasImage');
            break;
          }
        }
      }
    } catch (e) {}

    // Clip content → overflow:hidden
    try {
      if (node.clipsContent === true && (node.type === 'FRAME' || node.type === 'COMPONENT')) {
        parts.push('clip');
      }
    } catch (e) {}

    // Absolute positioning
    try {
      if (node.layoutPositioning === 'ABSOLUTE') {
        var absX = Math.round(node.x || 0);
        var absY = Math.round(node.y || 0);
        parts.push('absolute x:' + absX + ',y:' + absY);
      }
    } catch (e) {}

    var line = indent + parts.join(' ');
    lines.push(line);
    totalChars += line.length;

    if ('children' in node) {
      for (var c = 0; c < node.children.length; c++) {
        walkTree(node.children[c], depth + 1);
      }
    }
  }

  walkTree(root, 0);
  return lines.join('\n');
}

function generatePrompt(framework, root) {
  if (!framework) framework = 'expo';
  var isExpo = framework === 'expo';
  if (!root) root = figma.currentPage;

  var isPage = root.type === 'PAGE';
  var isSingleScreen = !isPage && root.parent && root.parent.type === 'PAGE';
  var isComponent = root.type === 'COMPONENT' || root.type === 'COMPONENT_SET';
  var scopeName = isPage ? figma.currentPage.name : root.name;

  var screenTree = serializeScreenTree(root);
  var intents = collectIntentAnnotations(root);
  var responsive = collectResponsiveAnnotations(root);
  var states = checkStateCoverage(root);
  var nav = analyzeNavigation();
  var assets = auditAssets();
  var components = mapComponents();

  return exportDesignTokens().then(function(tokens) {
    var date = new Date().toISOString().split('T')[0];
    var P = []; // prompt lines

    // ── Header ──
    P.push('# Implementation Brief: ' + scopeName);
    P.push('Generated: ' + date + ' | Target: ' + (isExpo ? 'React Native (Expo SDK 52+) with expo-router' : 'React Native CLI with React Navigation'));
    P.push('');

    // ── Figma MCP Context ──
    P.push('## Figma MCP Context');
    P.push('The layer tree below contains ALL exact design values inline — colors, spacing, typography, gradients, shadows, opacity, and positioning. You can implement directly from the tree without any external tool calls.');
    P.push('');
    P.push('If you have Figma MCP server access, use these tools for **supplementary verification**:');
    P.push('- `get_design_context(nodeId)` — cross-check values or inspect additional properties not in the tree');
    P.push('- `get_screenshot(nodeId)` — capture a visual screenshot to verify your implementation matches the design');
    P.push('Node IDs are prefixed with # in the layer tree (e.g., #123:456).');
    P.push('');

    // ── Tech Stack ──
    P.push('## Tech Stack & Dependencies');
    P.push('```');
    if (isExpo) {
      P.push('react-native       Expo SDK 52+ (managed workflow)');
      P.push('expo-router         File-based routing with typed routes');
      P.push('react-native-reanimated   Layout animations and gestures');
      P.push('react-native-safe-area-context   SafeAreaView wrapper');
      P.push('@expo/vector-icons  Icon library (MaterialIcons, Ionicons, Feather)');
      P.push('expo-image           Optimized <Image> with caching & blurhash');
      P.push('expo-linear-gradient LinearGradient for gradient fills');
    } else {
      P.push('react-native       React Native CLI (latest stable)');
      P.push('@react-navigation/native          Navigation container');
      P.push('@react-navigation/native-stack    Stack navigator');
      P.push('@react-navigation/bottom-tabs     Tab navigator');
      P.push('react-native-reanimated   Layout animations and gestures');
      P.push('react-native-safe-area-context   SafeAreaView wrapper');
      P.push('react-native-vector-icons  Icon library (MaterialIcons, Ionicons, Feather)');
      P.push('react-native-fast-image    Optimized <Image> with caching');
      P.push('react-native-linear-gradient  LinearGradient for gradient fills');
    }
    P.push('```');
    P.push('');

    // ── Coding Standards ──
    P.push('## Implementation Rules');
    P.push('');
    P.push('### Component Architecture');
    P.push('- TypeScript with explicit `Props` interface for every component');
    P.push('- Functional components only — `React.FC<Props>` pattern');
    P.push('- Colocate `StyleSheet.create()` at the bottom of each file — never inline styles');
    P.push('- Extract reusable components into `components/` directory');
    P.push('- Screen components go in `' + (isExpo ? 'app/' : 'src/screens/') + '` directory' + (isExpo ? ' (expo-router convention)' : ''));
    P.push('');
    P.push('### Layout Translation (Figma Auto Layout → RN Flexbox)');
    P.push('The layer tree uses compact notation. Translate directly to RN StyleSheet:');
    P.push('- `flex:row` → `flexDirection: "row"` | `flex:column` → `flexDirection: "column"`');
    P.push('- `gap:N` → `gap: N`');
    P.push('- `p:N` → `padding: N` | `py:N,px:M` → `paddingVertical: N, paddingHorizontal: M`');
    P.push('- `justify:center` → `justifyContent: "center"` | `align:center` → `alignItems: "center"`');
    P.push('- `w:fill` → `flex: 1` (fills available space) | `w:N` → `width: N` (fixed)');
    P.push('- `h:fill` → `flex: 1` on cross-axis | `h:N` → `height: N`');
    P.push('- `r:N` → `borderRadius: N`');
    P.push('- `clip` → `overflow: "hidden"`');
    P.push('- `shadow:x,y,blur,#colorAA` → `shadowOffset: {width:x, height:y}, shadowRadius: blur, shadowColor: "#colorAA", elevation: Math.ceil(blur/2)`');
    P.push('- `shadow:x,y,blur,spread,#colorAA` → same as above + `shadowSpread` (iOS only, use elevation on Android)');
    P.push('- `border:W,#color` → `borderWidth: W, borderColor: "#color"`');
    P.push('- `bg:#hex` → `backgroundColor: "#hex"` | `bg:#hex/N` → `backgroundColor: "#hex"` with `opacity: N` on the fill');
    P.push('- `bg:linear-gradient(Ndeg,#stop1@0%,#stop2@100%)` → use `' + (isExpo ? 'expo-linear-gradient' : 'react-native-linear-gradient') + '` with `colors` and `start`/`end` props');
    P.push('- `opacity:N` → `opacity: N`');
    P.push('- `r:TL,TR,BR,BL` → `borderTopLeftRadius: TL, borderTopRightRadius: TR, borderBottomRightRadius: BR, borderBottomLeftRadius: BL`');
    P.push('- `lh:auto` → omit lineHeight (RN default) | `lh:N%` → `lineHeight: fontSize * N / 100`');
    P.push('- `ls:N` → `letterSpacing: N` | `ls:N%` → `letterSpacing: fontSize * N / 100`');
    P.push('- `underline` → `textDecorationLine: "underline"` | `strikethrough` → `textDecorationLine: "line-through"`');
    P.push('- `uppercase` → `textTransform: "uppercase"` | `lowercase` → `textTransform: "lowercase"` | `capitalize` → `textTransform: "capitalize"`');
    P.push('- `absolute x:N,y:M` → `position: "absolute", left: N, top: M`');
    P.push('- `hasImage` → use `' + (isExpo ? '<Image> from expo-image' : '<FastImage> from react-native-fast-image') + '` — do NOT recreate in code, export asset from Figma');
    P.push('');
    P.push('### RN Best Practices');
    P.push('- Wrap root screen in `<SafeAreaView>` from `react-native-safe-area-context`');
    P.push('- Use `<Pressable>` for all interactive elements (not TouchableOpacity)');
    P.push('- Render repeating items with `<FlatList>` (not `.map()`) for virtualization');
    P.push('- Use `' + (isExpo ? 'expo-image' : 'react-native-fast-image') + '` instead of `<Image>` for network images (caching' + (isExpo ? ', blurhash' : '') + ')');
    P.push('- Handle keyboard with `<KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>` ');
    P.push('- Use `useCallback` for event handlers passed to child components');
    P.push('- Reference theme tokens instead of hardcoding hex values');
    P.push('');
    P.push('### DRY & SOLID Principles');
    P.push('- **DRY (Don\'t Repeat Yourself):** If a UI pattern appears 2+ times, extract it into a shared component. Never duplicate style objects — define once in theme and reference everywhere.');
    P.push('- **Single Responsibility:** Each component does ONE thing. A `<ProductCard>` renders a card — it does NOT fetch data, manage navigation, or handle global state.');
    P.push('- **Open/Closed:** Design components to be extensible via props (variants, size, colorScheme) without modifying the component source. Use composition over configuration.');
    P.push('- **Interface Segregation:** Keep prop interfaces small and focused. A `<Button>` should not accept 20 props — split into `<IconButton>`, `<TextButton>`, `<FloatingActionButton>` if needed.');
    P.push('- **Dependency Inversion:** Components should depend on abstractions (theme tokens, navigation hooks) not concrete values. Never hardcode colors, spacing, or routes inside components.');
    P.push('');
    P.push('### Performance');
    P.push('- Use `React.memo()` for components that receive stable props but re-render due to parent updates');
    P.push('- Use `useMemo` for expensive computations (filtering lists, transforming data) inside render');
    P.push('- Use `useCallback` for all callback props passed to child components or FlatList renderItem');
    P.push('- Avoid anonymous arrow functions in JSX — extract to named handlers or `useCallback`');
    P.push('- Use `keyExtractor` with stable unique IDs in FlatList (never use array index)');
    P.push('- Lazy load heavy screens with `React.lazy()`' + (isExpo ? ' or expo-router dynamic imports' : ''));
    P.push('- Optimize images: use `' + (isExpo ? 'expo-image` with `contentFit`, `placeholder` (blurhash), and `cachePolicy`' : 'react-native-fast-image` with `resizeMode`, `cache`, and `priority` props'));
    P.push('');
    P.push('### Mobile UX Patterns');
    P.push('- All touch targets must be minimum 44x44pt (Apple HIG) / 48x48dp (Material Design)');
    P.push('- Add `hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}` to small Pressable targets');
    P.push('- Provide haptic feedback on important actions: `import * as Haptics from "' + (isExpo ? 'expo-haptics' : 'react-native-haptic-feedback') + '"`');
    P.push('- Show loading states with `<ActivityIndicator>` or skeleton placeholders — never leave the screen blank');
    P.push('- Handle empty states with friendly illustrations and actionable CTAs');
    P.push('- Handle error states with retry buttons — never show raw error messages to users');
    P.push('- Support dark mode: use `useColorScheme()` and define light/dark token variants in theme');
    P.push('- Respect platform conventions: iOS uses slide-from-right navigation, Android uses fade/slide-up');
    P.push('');
    P.push('### Code Organization');
    P.push('```');
    P.push('src/');
    P.push('  constants/');
    P.push('    theme.ts          // Colors, Typography, Spacing tokens');
    P.push('    index.ts          // Barrel export');
    P.push('  components/');
    P.push('    ui/               // Atomic: Button, Input, Badge, Avatar, Icon');
    P.push('    cards/            // Composed: ProductCard, ProfileCard, NotificationCard');
    P.push('    layout/           // Structural: Header, Footer, ScreenWrapper, Divider');
    P.push('  hooks/');
    P.push('    useTheme.ts       // Theme access hook');
    P.push('  types/');
    P.push('    index.ts          // Shared TypeScript types');
    if (isExpo) {
      P.push('  app/                // expo-router screens (auto-routed)');
    } else {
      P.push('  screens/            // Screen components');
      P.push('  navigation/');
      P.push('    RootNavigator.tsx // createNativeStackNavigator + createBottomTabNavigator');
    }
    P.push('```');
    P.push('');

    // ── Design Tokens as TypeScript ──
    P.push('## Design Tokens');
    P.push('Create `constants/theme.ts` with these values extracted from the Figma design system:');
    P.push('');

    if (tokens.colors.length > 0) {
      P.push('### Colors');
      P.push('```typescript');
      P.push('export const Colors = {');
      for (var ci = 0; ci < tokens.colors.length; ci++) {
        var rawName = tokens.colors[ci].name;
        var cName = rawName.replace(/[\s/\-\.]+/g, '_').replace(/[^a-zA-Z0-9_]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '');
        if (!cName || /^\d/.test(cName)) cName = 'color_' + (cName || ci);
        P.push('  ' + cName + ': "' + tokens.colors[ci].hex + '",');
      }
      P.push('} as const;');
      P.push('```');
      P.push('');
    }

    if (tokens.typography.length > 0) {
      P.push('### Typography');
      P.push('```typescript');
      P.push('import { StyleSheet } from "react-native";');
      P.push('');
      P.push('export const Typography = StyleSheet.create({');
      for (var ti = 0; ti < tokens.typography.length; ti++) {
        var t = tokens.typography[ti];
        var tName = t.name.replace(/[\s/\-\.]+/g, '_').replace(/[^a-zA-Z0-9_]/g, '').replace(/_+/g, '_').replace(/^_|_$/g, '');
        if (!tName || /^\d/.test(tName)) tName = 'text_' + (tName || ti);
        var tProps = ['fontSize: ' + t.fontSize];
        if (t.fontWeight) tProps.push('fontWeight: "' + t.fontWeight + '"');
        if (t.lineHeight) tProps.push('lineHeight: ' + t.lineHeight);
        if (t.letterSpacing) tProps.push('letterSpacing: ' + t.letterSpacing);
        P.push('  ' + tName + ': { ' + tProps.join(', ') + ' },');
      }
      P.push('});');
      P.push('```');
      P.push('');
    }

    if (tokens.spacing.length > 0) {
      P.push('### Spacing Scale');
      P.push('```typescript');
      P.push('export const Spacing = {');
      for (var si = 0; si < tokens.spacing.length; si++) {
        var sName = tokens.spacing[si].name.replace(/[\s/\-\.]+/g, '_').replace(/[^a-zA-Z0-9_]/g, '');
        if (!sName) sName = 'space_' + si;
        P.push('  ' + sName + ': ' + tokens.spacing[si].value + ',');
      }
      P.push('} as const;');
      P.push('```');
      P.push('');
    }

    // ── Layer Tree ──
    if (isSingleScreen) {
      P.push('## Screen: ' + scopeName + ' (node: #' + root.id + ')');
      P.push('Inspect this screen via MCP: `get_design_context("' + root.id + '")`');
    } else if (isComponent) {
      P.push('## Component: ' + scopeName + ' (node: #' + root.id + ')');
      P.push('Inspect this component via MCP: `get_design_context("' + root.id + '")`');
    } else {
      P.push('## Layer Tree');
    }
    P.push('');
    P.push('Each line format: `Name (TYPE) #nodeId [layout-props] sizing bg:color r:radius opacity shadow ...`');
    P.push('All exact values (colors, spacing, typography, gradients, shadows, opacity) are inline. Use #nodeId with MCP tools only for supplementary verification.');
    P.push('');
    P.push('```');
    P.push(screenTree);
    P.push('```');
    P.push('');

    // ── Component → RN Mapping Table ──
    if (components.length > 0) {
      P.push('## Component → React Native Mapping');
      P.push('');
      P.push('| Figma Component | RN Element | Import | Variants/Props |');
      P.push('|---|---|---|---|');
      var compMax = Math.min(components.length, 40);
      for (var cmi = 0; cmi < compMax; cmi++) {
        var comp = components[cmi];
        var propNames = comp.props.length > 0
          ? comp.props.map(function(p) { return p.name + ':' + p.type; }).join(', ')
          : '-';
        var varStr = comp.variants.length > 0
          ? comp.variants.length + ' variants'
          : '';
        var propsCol = varStr && propNames !== '-' ? varStr + '; ' + propNames : (varStr || propNames);
        P.push('| ' + comp.name + ' | `<' + comp.rnComponent + '>` | `' + comp.rnImport + '` | ' + propsCol + ' |');
      }
      P.push('');
    }

    // ── Navigation Architecture ──
    if (nav.screens.length > 1 || nav.edges.length > 0) {
      P.push('## Navigation Architecture');
      P.push('Pattern: **' + nav.navType.join(' + ') + '** navigation');
      P.push('');

      var hasTab = nav.navType.indexOf('TAB') !== -1;

      if (isExpo) {
        // expo-router file structure
        P.push('### expo-router File Structure');
        P.push('```');
        P.push('app/');
        P.push('  _layout.tsx              // RootLayout: Stack or Tab navigator');
        if (hasTab) {
          P.push('  (tabs)/');
          P.push('    _layout.tsx           // TabLayout: <Tabs> with screenOptions');
          for (var tsi = 0; tsi < nav.screens.length; tsi++) {
            var tabRoute = nav.screens[tsi].name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^screen[-/]*/i, '').replace(/^-|-$/g, '');
            if (!tabRoute) tabRoute = 'screen-' + tsi;
            P.push('    ' + tabRoute + '.tsx');
          }
        } else {
          for (var ssi = 0; ssi < nav.screens.length; ssi++) {
            var stackRoute = nav.screens[ssi].name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^screen[-/]*/i, '').replace(/^-|-$/g, '');
            if (!stackRoute) stackRoute = 'screen-' + ssi;
            P.push('  ' + stackRoute + '.tsx');
          }
        }
        P.push('```');
      } else {
        // React Navigation setup
        P.push('### React Navigation Setup');
        P.push('```');
        P.push('src/navigation/');
        P.push('  RootNavigator.tsx       // NavigationContainer + Stack/Tab setup');
        if (hasTab) {
          P.push('  TabNavigator.tsx        // createBottomTabNavigator');
        }
        P.push('src/screens/');
        for (var csi = 0; csi < nav.screens.length; csi++) {
          var cliRoute = nav.screens[csi].name.replace(/[^a-zA-Z0-9]+/g, '');
          if (!cliRoute) cliRoute = 'Screen' + csi;
          P.push('  ' + cliRoute + 'Screen.tsx');
        }
        P.push('```');
      }
      P.push('');

      // Screen transitions → router API calls
      if (nav.edges.length > 0) {
        P.push('### Screen Transitions');
        for (var ni = 0; ni < nav.edges.length; ni++) {
          var edge = nav.edges[ni];
          var routerCall;
          if (isExpo) {
            routerCall = 'router.push';
            if (edge.navigationType === 'OVERLAY') routerCall = 'Modal / router.push (presentation: "modal")';
            else if (edge.transition === 'SLIDE_OUT' || edge.navigationType === 'BACK') routerCall = 'router.back';
            else if (edge.navigationType === 'SWAP') routerCall = 'router.replace';
          } else {
            routerCall = 'navigation.navigate';
            if (edge.navigationType === 'OVERLAY') routerCall = 'Modal / navigation.navigate (presentation: "modal")';
            else if (edge.transition === 'SLIDE_OUT' || edge.navigationType === 'BACK') routerCall = 'navigation.goBack';
            else if (edge.navigationType === 'SWAP') routerCall = 'navigation.replace';
          }
          P.push('- **' + edge.sourceScreen + '** → **' + edge.destinationScreen + '** via `' + routerCall + '` (trigger: `' + edge.triggerNode + '`, event: ' + edge.triggerType + ')');
        }
        P.push('');
      }
    }

    // ── Assets ──
    if (assets.totalAssets > 0) {
      P.push('## Assets');
      P.push('- **' + assets.imageCount + ' raster images** — export from Figma as @1x/@2x/@3x PNG, place in `assets/images/`');
      P.push('- **' + assets.iconCount + ' icons** — export as SVG or use `' + (isExpo ? '@expo/vector-icons' : 'react-native-vector-icons') + '` equivalents');
      P.push('- Load raster images with `' + (isExpo ? 'expo-image' : 'react-native-fast-image') + '`: `<Image source={require("../assets/images/name.png")} />`');
      P.push('- For SVG icons, use `react-native-svg` or match to `' + (isExpo ? '@expo/vector-icons' : 'react-native-vector-icons') + '` glyphs');
      P.push('- NEVER recreate images or icons in code — always reference exported assets');
      if (assets.issues.length > 0) {
        P.push('');
        P.push('Asset issues to fix before export:');
        for (var ai = 0; ai < Math.min(assets.issues.length, 10); ai++) {
          P.push('- `' + assets.issues[ai].name + '`: ' + assets.issues[ai].message);
        }
      }
      P.push('');
    }

    // ── Responsive Behavior ──
    if (responsive.length > 0) {
      P.push('## Responsive Behavior Annotations');
      for (var ri = 0; ri < responsive.length; ri++) {
        var rn = responsive[ri];
        var hintParts = [];
        if (rn.hints.scrollable) hintParts.push('wrap in `<ScrollView>` or `<FlatList>`');
        if (rn.hints.truncate) hintParts.push('`numberOfLines={1} ellipsizeMode="tail"`');
        if (rn.hints.fixed) hintParts.push('`position: "absolute"` with `bottom: 0` or sticky header');
        if (rn.hints.expandable) hintParts.push('`Animated.View` with `useAnimatedStyle()` height interpolation');
        if (rn.hints.platform) hintParts.push('`Platform.OS === "' + rn.hints.platform + '"` conditional rendering');
        if (hintParts.length > 0) {
          P.push('- **' + rn.name + '** (#' + rn.id + '): ' + hintParts.join('; '));
        }
      }
      P.push('');
    }

    // ── Missing States ──
    if (states.length > 0) {
      var hasMissing = false;
      for (var msi = 0; msi < states.length; msi++) {
        if (states[msi].missingStates.length > 0) { hasMissing = true; break; }
      }
      if (hasMissing) {
        P.push('## Missing Component States');
        P.push('These states are NOT designed in Figma. Implement them programmatically using the existing states as reference:');
        for (var msj = 0; msj < states.length; msj++) {
          var ms = states[msj];
          if (ms.missingStates.length > 0) {
            P.push('- **' + ms.componentName + '** (' + ms.componentType + '): implement `' + ms.missingStates.join('`, `') + '` — existing: ' + ms.existingStates.join(', '));
          }
        }
        P.push('');
      }
    }

    // ── Implementation Order ──
    P.push('## Implementation Order');
    P.push('1. **Theme setup** — create `constants/theme.ts` with Colors, Typography, Spacing tokens above');
    if (nav.screens.length > 1) {
      P.push('2. **Navigation scaffold** — set up ' + (isExpo ? 'expo-router `_layout.tsx`' : 'React Navigation `RootNavigator.tsx`') + ' with ' + nav.navType.join('+') + ' navigator');
      P.push('3. **Shared components** — build reusable components first (buttons, cards, inputs, headers) from the mapping table');
      P.push('4. **Screen composition** — compose screens using shared components, referencing the layer tree');
      P.push('5. **Interactions** — wire up navigation transitions, gestures, and state management');
      P.push('6. **Visual QA** — use `get_screenshot` on each screen node to compare against your implementation');
    } else {
      P.push('2. **Shared components** — extract reusable components from the layer tree (buttons, cards, inputs)');
      P.push('3. **Screen build** — compose the ' + (isSingleScreen ? 'screen' : 'layout') + ' following the layer tree hierarchy');
      P.push('4. **Interactions** — add touch handlers, state management, and animations');
      P.push('5. **Visual QA** — use `get_screenshot("' + (root.id || '') + '")` to compare against the Figma design');
    }
    P.push('');

    var promptText = P.join('\n');

    // ── Stats ──
    var screenCount = isPage ? nav.screenCount : (isSingleScreen ? 1 : 0);

    return {
      prompt: promptText,
      stats: {
        screens: screenCount,
        tokens: tokens.colors.length + tokens.typography.length + tokens.spacing.length,
        components: components.length,
        connections: nav.connectionCount,
        assets: assets.totalAssets,
        annotations: responsive.length,
        missingStates: states.filter(function(s) { return s.missingStates.length > 0; }).length
      }
    };
  });
}


// ═══════════════════════════════════════════════════════════
// TAB 6: STYLE QA — DESIGN BEST PRACTICES FOR RN AI CODEGEN
// ═══════════════════════════════════════════════════════════

var STANDARD_FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20, 22, 24, 28, 30, 32, 36, 40, 48, 56, 64, 72];
var COLOR_WORD_PATTERN = /^(red|blue|green|yellow|purple|pink|orange|grey|gray|white|black|dark|light)([-_\s]|[A-Z])/i;

function hexToRgb(hex) {
  var result = /^#([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  return {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  };
}



// ═══════════════════════════════════════════════════════════
// TAB 3: FIX — SMART RENAME & DESCRIBE
// ═══════════════════════════════════════════════════════════

function getTextContent(node) {
  var texts = [];
  walk(node, function(child) {
    if (child.type === 'TEXT') {
      var content = child.characters.trim();
      if (content.length > 0 && content.length < 40) {
        texts.push(content);
      }
    }
  });
  return texts;
}

function hasIconChild(node) {
  if (!('children' in node)) return false;
  for (var i = 0; i < node.children.length; i++) {
    var child = node.children[i];
    if (child.type === 'INSTANCE' && child.name.toLowerCase().includes('icon')) return true;
    if (child.type === 'VECTOR' || child.type === 'BOOLEAN_OPERATION') return true;
  }
  return false;
}

function hasImageChild(node) {
  if (!('children' in node)) return false;
  for (var i = 0; i < node.children.length; i++) {
    var child = node.children[i];
    if (child.type === 'IMAGE') return true;
    try {
      if (child.fills && Array.isArray(child.fills) && child.fills.some(function(f) { return f.type === 'IMAGE'; })) return true;
    } catch (e) {}
  }
  return false;
}

function getChildTypes(node) {
  if (!('children' in node)) return [];
  var types = {};
  for (var i = 0; i < node.children.length; i++) {
    var t = node.children[i].type;
    types[t] = (types[t] || 0) + 1;
  }
  return types;
}

function smartRename(node) {
  var texts = getTextContent(node);
  var parentName = node.parent ? node.parent.name : '';
  var isInSection = parentName && !UNNAMED_PATTERN.test(parentName);
  var childTypes = getChildTypes(node);

  // Frame containing only text -> use text content
  if (texts.length === 1) {
    var name = texts[0];
    return name.length > 30 ? name.substring(0, 27) + '...' : name;
  }

  // Frame containing multiple texts -> combine first two
  if (texts.length > 1) {
    var combined = texts.slice(0, 2).join(' / ');
    return combined.length > 30 ? combined.substring(0, 27) + '...' : combined;
  }

  // Frame with icon instances
  if (hasIconChild(node)) {
    return isInSection ? parentName + ' / Icon Container' : 'Icon Container';
  }

  // Frame with image
  if (hasImageChild(node)) {
    return isInSection ? parentName + ' / Image Container' : 'Image Container';
  }

  // Frame with only instances -> "Component Row/Stack"
  if (childTypes['INSTANCE'] && Object.keys(childTypes).length === 1) {
    var instanceCount = childTypes['INSTANCE'];
    return isInSection ? parentName + ' / Instance Group (' + instanceCount + ')' : 'Instance Group (' + instanceCount + ')';
  }

  // Frame with rectangles only -> "Shape Container"
  if (childTypes['RECTANGLE'] && Object.keys(childTypes).length === 1) {
    return isInSection ? parentName + ' / Shape Container' : 'Shape Container';
  }

  // Context-based: use parent section name
  if (isInSection && node.parent && 'children' in node.parent) {
    var childIndex = node.parent.children.indexOf(node);
    return parentName + ' / Item ' + (childIndex + 1);
  }

  // Fallback based on type and child count
  var count = 'children' in node ? node.children.length : 0;
  if (count === 0) return node.type.toLowerCase().replace(/_/g, '-');
  return 'Container (' + count + ' layers)';
}

function collectUnnamedWithSuggestions() {
  var root = figma.currentPage;
  var results = [];

  walk(root, function(node) {
    if (node.type === 'PAGE') return;
    if (UNNAMED_PATTERN.test(node.name)) {
      results.push({
        id: node.id,
        currentName: node.name,
        suggestedName: smartRename(node),
        path: nodePath(node),
        type: node.type
      });
    }
  });

  return results;
}

function batchRename(mappings) {
  var renamed = 0;
  var errors = [];
  var promises = [];
  for (var i = 0; i < mappings.length; i++) {
    (function(m) {
      promises.push(
        figma.getNodeByIdAsync(m.id).then(function(node) {
          if (node) { node.name = m.newName; renamed++; }
          else { errors.push(m.id); }
        })
      );
    })(mappings[i]);
  }
  return Promise.all(promises).then(function() {
    return { renamed: renamed, errors: errors };
  });
}

function findAndReplaceNames(find, replace) {
  var root = figma.currentPage;
  var count = 0;
  walk(root, function(node) {
    if (node.type === 'PAGE') return;
    if (node.name.includes(find)) {
      node.name = node.name.split(find).join(replace);
      count++;
    }
  });
  return count;
}


// Auto-generate component descriptions
function generateDescriptions() {
  var root = figma.currentPage;
  var generated = 0;
  var results = [];

  walk(root, function(node) {
    if ((node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && !isVariantComponent(node)) {
      try {
        if (node.description && node.description.trim() !== '') return;
      } catch (e) {
        return;
      }

      var desc = buildDescription(node);
      results.push({
        id: node.id,
        name: node.name,
        path: nodePath(node),
        generatedDesc: desc
      });
    }
  });

  return results;
}

function buildDescription(node) {
  var name = node.name;
  var parts = [];

  // If it's a component set, describe its variants
  if (node.type === 'COMPONENT_SET' && 'children' in node) {
    var props = {};
    for (var i = 0; i < node.children.length; i++) {
      var child = node.children[i];
      var variantParts = child.name.split(',');
      for (var j = 0; j < variantParts.length; j++) {
        var kv = variantParts[j].trim().split('=');
        if (kv.length === 2) {
          var key = kv[0].trim();
          var val = kv[1].trim();
          if (!props[key]) props[key] = [];
          if (props[key].indexOf(val) === -1) props[key].push(val);
        }
      }
    }

    var propKeys = Object.keys(props);
    if (propKeys.length > 0) {
      var propDescs = [];
      for (var k = 0; k < propKeys.length; k++) {
        propDescs.push(props[propKeys[k]].length + ' ' + propKeys[k].toLowerCase() + ' variants (' + props[propKeys[k]].join(', ') + ')');
      }
      parts.push(name + ' component with ' + propDescs.join(', ') + '.');
    } else {
      parts.push(name + ' component with ' + node.children.length + ' variants.');
    }
  } else if (node.type === 'COMPONENT') {
    // Single component: describe based on name and children
    var nameParts = name.split(/[=,]/);
    if (nameParts.length > 1) {
      parts.push(nameParts[0].trim() + ' component variant.');
    } else {
      var childCount = 'children' in node ? node.children.length : 0;
      parts.push(name + ' component' + (childCount > 0 ? ' with ' + childCount + ' child layers.' : '.'));
    }
  }

  return parts.join(' ') || name + ' component.';
}

function applyDescriptions(mappings) {
  var applied = 0;
  var errors = [];
  var promises = [];
  for (var i = 0; i < mappings.length; i++) {
    (function(m) {
      promises.push(
        figma.getNodeByIdAsync(m.id).then(function(node) {
          if (node && (node.type === 'COMPONENT' || node.type === 'COMPONENT_SET') && !isVariantComponent(node)) {
            try { node.description = m.description; applied++; }
            catch (e) { errors.push(m.id); }
          } else { errors.push(m.id); }
        })
      );
    })(mappings[i]);
  }
  return Promise.all(promises).then(function() {
    return { applied: applied, errors: errors };
  });
}


// ═══════════════════════════════════════════════════════════
// TAB 3: FIX — AUTO LAYOUT (with smart direction detection)
// ═══════════════════════════════════════════════════════════

function collectNoAutoLayout() {
  var root = figma.currentPage;
  var results = [];

  walk(root, function(node) {
    if (node.type === 'FRAME' && 'children' in node && node.children.length > 0) {
      if (!node.layoutMode || node.layoutMode === 'NONE') {
        var info = serializeNode(node);
        info.suggestedDirection = detectLayoutDirection(node);
        results.push(info);
      }
    }
  });

  return results;
}

function detectLayoutDirection(node) {
  if (!('children' in node) || node.children.length < 2) return 'VERTICAL';

  var children = node.children;
  var xSpread = 0;
  var ySpread = 0;

  // Calculate total spread in X and Y
  var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

  for (var i = 0; i < children.length; i++) {
    var child = children[i];
    if (child.x < minX) minX = child.x;
    if (child.x + child.width > maxX) maxX = child.x + child.width;
    if (child.y < minY) minY = child.y;
    if (child.y + child.height > maxY) maxY = child.y + child.height;
  }

  xSpread = maxX - minX;
  ySpread = maxY - minY;

  // Check if children overlap significantly in one axis
  var xOverlap = 0;
  var yOverlap = 0;
  for (var j = 1; j < children.length; j++) {
    // X overlap: children share horizontal space (stacked vertically)
    var prevRight = children[j - 1].x + children[j - 1].width;
    var currLeft = children[j].x;
    if (currLeft < prevRight) xOverlap++;

    // Y overlap: children share vertical space (arranged horizontally)
    var prevBottom = children[j - 1].y + children[j - 1].height;
    var currTop = children[j].y;
    if (currTop < prevBottom) yOverlap++;
  }

  // If most children overlap in X (same column), it's vertical layout
  // If most children overlap in Y (same row), it's horizontal layout
  if (yOverlap > xOverlap) return 'HORIZONTAL';
  if (xOverlap > yOverlap) return 'VERTICAL';

  // Fallback: if spread is wider than tall, horizontal
  return xSpread > ySpread ? 'HORIZONTAL' : 'VERTICAL';
}

function detectSpacing(node) {
  if (!('children' in node) || node.children.length < 2) return 8;

  var gaps = [];
  var dir = detectLayoutDirection(node);
  var children = node.children;

  for (var i = 1; i < children.length; i++) {
    var gap;
    if (dir === 'HORIZONTAL') {
      gap = children[i].x - (children[i - 1].x + children[i - 1].width);
    } else {
      gap = children[i].y - (children[i - 1].y + children[i - 1].height);
    }
    if (gap > 0) gaps.push(gap);
  }

  if (gaps.length === 0) return 8;

  // Return the most common gap (mode)
  var counts = {};
  var maxCount = 0;
  var modeGap = gaps[0];
  for (var j = 0; j < gaps.length; j++) {
    var rounded = Math.round(gaps[j]);
    counts[rounded] = (counts[rounded] || 0) + 1;
    if (counts[rounded] > maxCount) {
      maxCount = counts[rounded];
      modeGap = rounded;
    }
  }

  return modeGap;
}

function applyAutoLayout(nodeIds, direction, gap, padding) {
  var applied = 0;
  var errors = [];
  var promises = [];
  for (var i = 0; i < nodeIds.length; i++) {
    (function(id) {
      promises.push(
        figma.getNodeByIdAsync(id).then(function(node) {
          if (node && node.type === 'FRAME') {
            try {
              var dir = direction || detectLayoutDirection(node);
              var detectedGap = gap !== undefined && gap !== null ? gap : detectSpacing(node);
              node.layoutMode = dir;
              node.itemSpacing = detectedGap;
              node.paddingTop = padding !== undefined && padding !== null ? padding : 0;
              node.paddingRight = padding !== undefined && padding !== null ? padding : 0;
              node.paddingBottom = padding !== undefined && padding !== null ? padding : 0;
              node.paddingLeft = padding !== undefined && padding !== null ? padding : 0;
              node.primaryAxisAlignItems = 'MIN';
              node.counterAxisAlignItems = 'MIN';
              node.layoutSizingHorizontal = 'HUG';
              node.layoutSizingVertical = 'HUG';
              applied++;
            } catch (e) {
              errors.push({ id: id, error: e.message || String(e) });
            }
          } else {
            errors.push({ id: id, error: 'Node not found or not a frame' });
          }
        })
      );
    })(nodeIds[i]);
  }
  return Promise.all(promises).then(function() {
    return { applied: applied, errors: errors };
  });
}



function selectNodes(nodeIds) {
  var promises = [];
  for (var i = 0; i < nodeIds.length; i++) {
    promises.push(figma.getNodeByIdAsync(nodeIds[i]));
  }
  return Promise.all(promises).then(function(resolved) {
    var nodes = [];
    for (var r = 0; r < resolved.length; r++) {
      if (resolved[r]) nodes.push(resolved[r]);
    }
    figma.currentPage.selection = nodes;
    if (nodes.length > 0) {
      figma.viewport.scrollAndZoomIntoView(nodes);
    }
    return nodes.length;
  });
}


// ═══════════════════════════════════════════════════════════
// DEV EXPORT HELPERS (shared: used by AI Ready prompt generator)
// ═══════════════════════════════════════════════════════════

// ─── Constants ───

var RN_COMPONENT_MAP = {
  button: { rnComponent: 'TouchableOpacity', rnImport: "import { TouchableOpacity } from 'react-native'" },
  input: { rnComponent: 'TextInput', rnImport: "import { TextInput } from 'react-native'" },
  text: { rnComponent: 'Text', rnImport: "import { Text } from 'react-native'" },
  image: { rnComponent: 'Image', rnImport: "import { Image } from 'react-native'" },
  card: { rnComponent: 'View', rnImport: "import { View } from 'react-native'" },
  switch: { rnComponent: 'Switch', rnImport: "import { Switch } from 'react-native'" },
  toggle: { rnComponent: 'Switch', rnImport: "import { Switch } from 'react-native'" },
  checkbox: { rnComponent: 'Checkbox', rnImport: "import Checkbox from '@react-native-community/checkbox'" },
  radio: { rnComponent: 'RadioButton', rnImport: "import { RadioButton } from 'react-native-paper'" },
  modal: { rnComponent: 'Modal', rnImport: "import { Modal } from 'react-native'" },
  dialog: { rnComponent: 'Modal', rnImport: "import { Modal } from 'react-native'" },
  scroll: { rnComponent: 'ScrollView', rnImport: "import { ScrollView } from 'react-native'" },
  list: { rnComponent: 'FlatList', rnImport: "import { FlatList } from 'react-native'" },
  avatar: { rnComponent: 'Image', rnImport: "import { Image } from 'react-native'" },
  icon: { rnComponent: 'Icon', rnImport: "import Icon from 'react-native-vector-icons'" },
  badge: { rnComponent: 'Badge', rnImport: "import { Badge } from 'react-native-paper'" },
  chip: { rnComponent: 'Chip', rnImport: "import { Chip } from 'react-native-paper'" },
  toast: { rnComponent: 'Toast', rnImport: "import Toast from 'react-native-toast-message'" },
  dropdown: { rnComponent: 'Picker', rnImport: "import { Picker } from '@react-native-picker/picker'" },
  select: { rnComponent: 'Picker', rnImport: "import { Picker } from '@react-native-picker/picker'" },
  tab: { rnComponent: 'TabView', rnImport: "import { TabView } from 'react-native-tab-view'" },
  header: { rnComponent: 'View', rnImport: "import { View } from 'react-native'" },
  footer: { rnComponent: 'View', rnImport: "import { View } from 'react-native'" },
  nav: { rnComponent: 'NavigationContainer', rnImport: "import { NavigationContainer } from '@react-navigation/native'" },
  textarea: { rnComponent: 'TextInput', rnImport: "import { TextInput } from 'react-native'" },
  slider: { rnComponent: 'Slider', rnImport: "import Slider from '@react-native-community/slider'" },
  progress: { rnComponent: 'ProgressBar', rnImport: "import { ProgressBar } from 'react-native-paper'" },
  search: { rnComponent: 'TextInput', rnImport: "import { TextInput } from 'react-native'" }
};




// ─── Dev Export Helpers ───

function toCamelCase(str) {
  return str.replace(/[^a-zA-Z0-9]+(.)/g, function(match, chr) {
    return chr.toUpperCase();
  }).replace(/^[A-Z]/, function(chr) { return chr.toLowerCase(); });
}

function mapFontWeight(styleName) {
  if (!styleName) return '400';
  var s = styleName.toLowerCase();
  if (s.indexOf('thin') !== -1 || s.indexOf('hairline') !== -1) return '100';
  if (s.indexOf('extralight') !== -1 || s.indexOf('ultra light') !== -1) return '200';
  if (s.indexOf('light') !== -1) return '300';
  if (s.indexOf('medium') !== -1) return '500';
  if (s.indexOf('semibold') !== -1 || s.indexOf('semi bold') !== -1) return '600';
  if (s.indexOf('extrabold') !== -1 || s.indexOf('ultra bold') !== -1) return '800';
  if (s.indexOf('black') !== -1 || s.indexOf('heavy') !== -1) return '900';
  if (s.indexOf('bold') !== -1) return '700';
  return '400';
}


// ─── Feature 1: Design Token Export (Async) ───

function exportDesignTokens() {
  return Promise.all([
    figma.getLocalPaintStylesAsync(),
    figma.getLocalTextStylesAsync(),
    figma.getLocalEffectStylesAsync(),
    figma.variables.getLocalVariablesAsync(),
    figma.variables.getLocalVariableCollectionsAsync()
  ]).then(function(results) {
    var paintStyles = results[0];
    var textStyles = results[1];
    var effectStyles = results[2];
    var variables = results[3];
    var collections = results[4];

    var colors = [];
    for (var i = 0; i < paintStyles.length; i++) {
      var ps = paintStyles[i];
      try {
        var paints = ps.paints;
        if (paints && paints.length > 0 && paints[0].type === 'SOLID') {
          var c = paints[0].color;
          colors.push({
            name: ps.name,
            key: toCamelCase(ps.name.split('/').join(' ')),
            hex: rgbToHex(c.r, c.g, c.b),
            opacity: paints[0].opacity !== undefined ? paints[0].opacity : 1
          });
        }
      } catch (e) {}
    }

    var typography = [];
    for (var t = 0; t < textStyles.length; t++) {
      var ts = textStyles[t];
      var fontWeight = '400';
      try { fontWeight = mapFontWeight(ts.fontName ? ts.fontName.style : ''); } catch (e) {}
      var lhValue = null;
      try {
        if (ts.lineHeight && ts.lineHeight.unit !== 'AUTO') {
          lhValue = ts.lineHeight.value;
        }
      } catch (e) {}
      typography.push({
        name: ts.name,
        key: toCamelCase(ts.name.split('/').join(' ')),
        fontSize: ts.fontSize,
        fontFamily: ts.fontName ? ts.fontName.family : 'System',
        fontWeight: fontWeight,
        lineHeight: lhValue,
        letterSpacing: ts.letterSpacing ? ts.letterSpacing.value : 0
      });
    }

    var shadows = [];
    for (var ei = 0; ei < effectStyles.length; ei++) {
      var es = effectStyles[ei];
      try {
        var effs = es.effects;
        if (effs && effs.length > 0) {
          var shadowEffects = [];
          for (var ej = 0; ej < effs.length; ej++) {
            var eff = effs[ej];
            if (eff.type === 'DROP_SHADOW' || eff.type === 'INNER_SHADOW') {
              var sc = eff.color || { r: 0, g: 0, b: 0, a: 0.25 };
              shadowEffects.push({
                type: eff.type === 'DROP_SHADOW' ? 'dropShadow' : 'innerShadow',
                offsetX: eff.offset ? eff.offset.x : 0,
                offsetY: eff.offset ? eff.offset.y : 0,
                blur: eff.radius || 0,
                color: rgbToHex(sc.r, sc.g, sc.b),
                opacity: sc.a !== undefined ? Math.round(sc.a * 100) / 100 : 0.25
              });
            }
          }
          if (shadowEffects.length > 0) {
            shadows.push({
              name: es.name,
              key: toCamelCase(es.name.split('/').join(' ')),
              effects: shadowEffects
            });
          }
        }
      } catch (e) {}
    }

    var spacing = [];
    var hasDarkMode = false;
    for (var v = 0; v < variables.length; v++) {
      var vr = variables[v];
      if (vr.resolvedType === 'FLOAT') {
        var modes = Object.keys(vr.valuesByMode);
        var val = modes.length > 0 ? vr.valuesByMode[modes[0]] : 0;
        if (typeof val === 'number') {
          spacing.push({
            name: vr.name,
            key: toCamelCase(vr.name.split('/').join(' ')),
            value: val
          });
        }
      }
    }

    for (var ci = 0; ci < collections.length; ci++) {
      var col = collections[ci];
      if (col.modes && col.modes.length > 1) {
        for (var mi = 0; mi < col.modes.length; mi++) {
          if (col.modes[mi].name.toLowerCase().indexOf('dark') !== -1) {
            hasDarkMode = true;
            break;
          }
        }
      }
      if (hasDarkMode) break;
    }

    // Generate theme.ts code
    var tl = [];
    tl.push("// Auto-generated by Design System Auditor");
    tl.push('// ' + new Date().toISOString().split('T')[0]);
    tl.push('');
    tl.push('export const theme = {');
    tl.push('  colors: {');
    for (var ci2 = 0; ci2 < colors.length; ci2++) {
      var cComma = ci2 < colors.length - 1 ? ',' : '';
      tl.push("    " + colors[ci2].key + ": '" + colors[ci2].hex + "'" + cComma);
    }
    tl.push('  },');
    tl.push('  typography: {');
    for (var ti = 0; ti < typography.length; ti++) {
      var tComma = ti < typography.length - 1 ? ',' : '';
      var tItem = typography[ti];
      var lhStr = tItem.lineHeight ? ', lineHeight: ' + tItem.lineHeight : '';
      tl.push("    " + tItem.key + ": { fontSize: " + tItem.fontSize + ", fontWeight: '" + tItem.fontWeight + "'" + lhStr + ' }' + tComma);
    }
    tl.push('  },');
    tl.push('  shadows: {');
    for (var si = 0; si < shadows.length; si++) {
      var sComma = si < shadows.length - 1 ? ',' : '';
      if (shadows[si].effects.length > 0) {
        var se = shadows[si].effects[0];
        tl.push("    " + shadows[si].key + ": { shadowOffset: { width: " + se.offsetX + ', height: ' + se.offsetY + ' }, shadowRadius: ' + se.blur + ", shadowColor: '" + se.color + "', shadowOpacity: " + se.opacity + ' }' + sComma);
      }
    }
    tl.push('  },');
    tl.push('  spacing: {');
    for (var spi = 0; spi < spacing.length; spi++) {
      var spComma = spi < spacing.length - 1 ? ',' : '';
      tl.push('    ' + spacing[spi].key + ': ' + spacing[spi].value + spComma);
    }
    tl.push('  },');
    tl.push('};');

    return {
      colors: colors,
      typography: typography,
      shadows: shadows,
      spacing: spacing,
      themeCode: tl.join('\n'),
      hasDarkMode: hasDarkMode,
      stats: {
        paintCount: paintStyles.length,
        textCount: textStyles.length,
        effectCount: effectStyles.length,
        variableCount: variables.length
      }
    };
  });
}

// ─── Feature 2: Component Mapping ───

function mapComponents() {
  var root = figma.currentPage;
  var results = [];
  var rnKeys = Object.keys(RN_COMPONENT_MAP);

  walk(root, function(node) {
    if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') return;
    if (isVariantComponent(node)) return;

    var nameLower = node.name.toLowerCase();
    var matched = null;
    var matchedPattern = '';

    for (var k = 0; k < rnKeys.length; k++) {
      if (nameLower.indexOf(rnKeys[k]) !== -1) {
        matched = RN_COMPONENT_MAP[rnKeys[k]];
        matchedPattern = rnKeys[k];
        break;
      }
    }

    var props = [];
    var variants = [];
    try {
      if (node.componentPropertyDefinitions) {
        var defs = node.componentPropertyDefinitions;
        var defKeys = Object.keys(defs);
        for (var d = 0; d < defKeys.length; d++) {
          var def = defs[defKeys[d]];
          props.push({
            name: defKeys[d],
            type: def.type,
            defaultValue: def.defaultValue !== undefined ? String(def.defaultValue) : ''
          });
        }
      }
    } catch (e) {}

    if (node.type === 'COMPONENT_SET' && 'children' in node) {
      for (var vi = 0; vi < node.children.length; vi++) {
        variants.push(node.children[vi].name);
      }
    }

    results.push({
      id: node.id,
      name: node.name,
      type: node.type,
      path: nodePath(node),
      rnComponent: matched ? matched.rnComponent : 'View',
      rnImport: matched ? matched.rnImport : "import { View } from 'react-native'",
      matchedPattern: matchedPattern,
      props: props,
      variants: variants
    });
  });

  return results;
}

// ─── Feature 3: Navigation Structure ───

function analyzeNavigation() {
  var root = figma.currentPage;
  var screens = [];
  var edges = [];
  var children = root.children;

  for (var i = 0; i < children.length; i++) {
    var frame = children[i];
    if (frame.type !== 'FRAME') continue;
    screens.push({
      id: frame.id,
      name: frame.name,
      width: Math.round(frame.width),
      height: Math.round(frame.height)
    });
  }

  var screenIds = {};
  var nodeToScreen = {};
  for (var si = 0; si < screens.length; si++) {
    screenIds[screens[si].id] = screens[si].name;
  }

  // Build a map: nodeId -> parent screen, so we can resolve destinations without getNodeById
  for (var mi = 0; mi < children.length; mi++) {
    var mapFrame = children[mi];
    if (mapFrame.type !== 'FRAME') continue;
    walk(mapFrame, function(n) {
      nodeToScreen[n.id] = mapFrame;
    });
  }

  for (var fi = 0; fi < children.length; fi++) {
    var screen = children[fi];
    if (screen.type !== 'FRAME') continue;

    walk(screen, function(node) {
      try {
        if (!node.reactions || node.reactions.length === 0) return;
        for (var ri = 0; ri < node.reactions.length; ri++) {
          var reaction = node.reactions[ri];
          if (!reaction.action) continue;
          var action = reaction.action;
          if (action.type !== 'NODE' || !action.destinationId) continue;

          // Look up destination screen from pre-built map
          var destScreen = nodeToScreen[action.destinationId];
          if (!destScreen) {
            // Destination might be a top-level frame itself
            if (screenIds[action.destinationId]) {
              destScreen = { id: action.destinationId, name: screenIds[action.destinationId] };
            } else {
              continue;
            }
          }
          var destName = destScreen.name || screenIds[destScreen.id] || 'Unknown';

          var transition = action.transition;
          edges.push({
            sourceScreen: screen.name,
            sourceScreenId: screen.id,
            triggerNode: node.name,
            triggerNodeId: node.id,
            triggerType: reaction.trigger ? reaction.trigger.type : 'ON_CLICK',
            destinationScreen: destName,
            destinationScreenId: destScreen.id,
            navigationType: action.navigationType || 'NAVIGATE',
            transition: transition ? transition.type : 'INSTANT'
          });
        }
      } catch (e) {}
    });
  }

  // Infer navigation type
  var outgoing = {};
  for (var ei = 0; ei < edges.length; ei++) {
    var src = edges[ei].sourceScreenId;
    outgoing[src] = (outgoing[src] || 0) + 1;
  }

  var navTypes = [];
  var hasTab = false;
  var hasDrawer = false;
  for (var si2 = 0; si2 < screens.length; si2++) {
    var sName = screens[si2].name.toLowerCase();
    if (sName.indexOf('tab') !== -1 || sName.indexOf('bottom') !== -1) hasTab = true;
    if (sName.indexOf('drawer') !== -1 || sName.indexOf('menu') !== -1) hasDrawer = true;
    var out = outgoing[screens[si2].id] || 0;
    if (out >= 3) hasTab = true;
  }

  if (hasTab) navTypes.push('TAB');
  if (hasDrawer) navTypes.push('DRAWER');
  if (navTypes.length === 0) navTypes.push('STACK');

  return {
    screens: screens,
    edges: edges,
    navType: navTypes,
    screenCount: screens.length,
    connectionCount: edges.length
  };
}

// ─── Feature 4: Asset Audit ───

function auditAssets() {
  var root = figma.currentPage;
  var issues = [];
  var imageCount = 0;
  var iconCount = 0;

  walk(root, function(node) {
    if (node.type === 'PAGE') return;

    var hasImage = false;
    try {
      if (node.fills && Array.isArray(node.fills)) {
        for (var fi = 0; fi < node.fills.length; fi++) {
          if (node.fills[fi].type === 'IMAGE' && node.fills[fi].visible !== false) {
            hasImage = true;
            break;
          }
        }
      }
    } catch (e) {}

    if (hasImage) {
      imageCount++;
      if (UNNAMED_PATTERN.test(node.name)) {
        issues.push({
          id: node.id, name: node.name, type: node.type, path: nodePath(node),
          rule: 'unnamed-asset', message: 'Image asset has generic name',
          severity: 'warning', width: Math.round(node.width), height: Math.round(node.height)
        });
      }
      var w = Math.round(node.width);
      var h = Math.round(node.height);
      if (w % 3 !== 0 || h % 3 !== 0) {
        issues.push({
          id: node.id, name: node.name, type: node.type, path: nodePath(node),
          rule: 'non-3x-dimensions', message: 'Dimensions ' + w + 'x' + h + ' not divisible by 3 (for @3x export)',
          severity: 'info', width: w, height: h
        });
      }
    }

    var isIcon = node.name.toLowerCase().indexOf('icon') !== -1 ||
                 node.type === 'VECTOR' || node.type === 'BOOLEAN_OPERATION';
    if (isIcon && node.width <= 64 && node.height <= 64 && node.width > 0) {
      iconCount++;
      try {
        var exportSettings = node.exportSettings;
        if (exportSettings && exportSettings.length > 0) {
          for (var es = 0; es < exportSettings.length; es++) {
            if (exportSettings[es].format === 'PNG' || exportSettings[es].format === 'JPG') {
              issues.push({
                id: node.id, name: node.name, type: node.type, path: nodePath(node),
                rule: 'icon-should-be-svg', message: 'Small icon (' + Math.round(node.width) + 'x' + Math.round(node.height) + ') exported as raster — use SVG',
                severity: 'warning', width: Math.round(node.width), height: Math.round(node.height)
              });
              break;
            }
          }
        }
      } catch (e) {}
    }
  });

  return {
    issues: issues,
    imageCount: imageCount,
    iconCount: iconCount,
    totalAssets: imageCount + iconCount
  };
}

// ═══════════════════════════════════════════════════════════
// TAB 4: CLEANUP — Figma Designer Tools
// ═══════════════════════════════════════════════════════════

// ─── Feature 7: Detached Instance Finder ───

function findDetachedInstances() {
  var root = figma.currentPage;
  var results = [];

  walk(root, function(node) {
    if (node.type !== 'FRAME') return;
    try {
      if (node.detachedInfo) {
        var info = node.detachedInfo;
        var originalName = '';
        results.push({
          id: node.id,
          name: node.name,
          path: nodePath(node),
          detachedType: info.type || 'unknown',
          originalComponent: originalName,
          componentId: info.componentId || info.componentKey || ''
        });
      }
    } catch (e) {}
  });

  return results;
}

// ─── Feature 8: Unused Styles & Variables (Async) ───

function findUnusedStyles() {
  return Promise.all([
    figma.getLocalPaintStylesAsync(),
    figma.getLocalTextStylesAsync(),
    figma.getLocalEffectStylesAsync(),
    figma.variables.getLocalVariablesAsync()
  ]).then(function(results) {
    var paintStyles = results[0];
    var textStyles = results[1];
    var effectStyles = results[2];
    var variables = results[3];

    var usedStyleIds = {};
    var usedVariableIds = {};
    var root = figma.currentPage;

    walk(root, function(node) {
      if (node.type === 'PAGE') return;
      try {
        var fsi = node.fillStyleId;
        if (fsi && typeof fsi === 'string') usedStyleIds[fsi] = true;
      } catch (e) {}
      try {
        var ssi = node.strokeStyleId;
        if (ssi && typeof ssi === 'string') usedStyleIds[ssi] = true;
      } catch (e) {}
      try {
        var tsi = node.textStyleId;
        if (tsi && typeof tsi === 'string') usedStyleIds[tsi] = true;
      } catch (e) {}
      try {
        var esi = node.effectStyleId;
        if (esi && typeof esi === 'string') usedStyleIds[esi] = true;
      } catch (e) {}
      try {
        if (node.boundVariables) {
          var bvKeys = Object.keys(node.boundVariables);
          for (var bk = 0; bk < bvKeys.length; bk++) {
            var bv = node.boundVariables[bvKeys[bk]];
            if (bv && bv.id) {
              usedVariableIds[bv.id] = true;
            } else if (Array.isArray(bv)) {
              for (var ba = 0; ba < bv.length; ba++) {
                if (bv[ba] && bv[ba].id) usedVariableIds[bv[ba].id] = true;
              }
            }
          }
        }
      } catch (e) {}
    });

    var unusedStyles = [];
    var allStyles = paintStyles.concat(textStyles).concat(effectStyles);
    for (var i = 0; i < allStyles.length; i++) {
      var style = allStyles[i];
      if (!usedStyleIds[style.id]) {
        var styleType = 'PAINT';
        if (textStyles.indexOf(style) !== -1) styleType = 'TEXT';
        else if (effectStyles.indexOf(style) !== -1) styleType = 'EFFECT';
        unusedStyles.push({
          styleId: style.id,
          name: style.name,
          styleType: styleType,
          canRemove: true
        });
      }
    }

    var unusedVariables = [];
    for (var v = 0; v < variables.length; v++) {
      var vr = variables[v];
      if (!usedVariableIds[vr.id]) {
        unusedVariables.push({
          variableId: vr.id,
          name: vr.name,
          resolvedType: vr.resolvedType
        });
      }
    }

    return {
      unusedStyles: unusedStyles,
      unusedVariables: unusedVariables,
      totalStyles: allStyles.length,
      totalVariables: variables.length
    };
  });
}

// ─── Feature 9: Design System Coverage (Async) ───

function analyzeDesignSystemCoverage() {
  return Promise.all([
    figma.getLocalPaintStylesAsync(),
    figma.getLocalTextStylesAsync(),
    figma.variables.getLocalVariablesAsync()
  ]).then(function(results) {
    var root = figma.currentPage;
    var instances = 0;
    var plainFrames = 0;
    var styledFills = 0;
    var hardcodedFills = 0;
    var styledText = 0;
    var hardcodedText = 0;
    var boundVars = 0;
    var unboundVars = 0;

    walk(root, function(node) {
      if (node.type === 'PAGE') return;

      if (node.type === 'INSTANCE') {
        instances++;
      } else if (node.type === 'FRAME' && !isInsideInstance(node)) {
        plainFrames++;
      }

      try {
        if (node.fills && Array.isArray(node.fills) && node.fills.length > 0) {
          var hasSolid = false;
          for (var fi = 0; fi < node.fills.length; fi++) {
            if (node.fills[fi].type === 'SOLID' && node.fills[fi].visible !== false) {
              hasSolid = true;
              break;
            }
          }
          if (hasSolid) {
            var fsi = null;
            try { fsi = node.fillStyleId; } catch (e) {}
            if (fsi && typeof fsi === 'string') {
              styledFills++;
            } else {
              hardcodedFills++;
            }
          }
        }
      } catch (e) {}

      if (node.type === 'TEXT') {
        try {
          var tsi = node.textStyleId;
          if (tsi && typeof tsi === 'string') {
            styledText++;
          } else {
            hardcodedText++;
          }
        } catch (e) {
          hardcodedText++;
        }
      }

      try {
        if (node.boundVariables && Object.keys(node.boundVariables).length > 0) {
          boundVars++;
        } else if (node.type === 'FRAME' || node.type === 'COMPONENT' || node.type === 'INSTANCE') {
          unboundVars++;
        }
      } catch (e) {}
    });

    var compTotal = instances + plainFrames;
    var compPct = compTotal > 0 ? Math.round((instances / compTotal) * 100) : 100;
    var fillTotal = styledFills + hardcodedFills;
    var fillPct = fillTotal > 0 ? Math.round((styledFills / fillTotal) * 100) : 100;
    var textTotal = styledText + hardcodedText;
    var textPct = textTotal > 0 ? Math.round((styledText / textTotal) * 100) : 100;
    var varTotal = boundVars + unboundVars;
    var varPct = varTotal > 0 ? Math.round((boundVars / varTotal) * 100) : 100;

    var overallScore = Math.round(compPct * 0.3 + fillPct * 0.25 + textPct * 0.25 + varPct * 0.2);

    return {
      componentCoverage: { percentage: compPct, instances: instances, plainFrames: plainFrames },
      fillCoverage: { percentage: fillPct, styled: styledFills, hardcoded: hardcodedFills },
      textCoverage: { percentage: textPct, styled: styledText, hardcoded: hardcodedText },
      variableCoverage: { percentage: varPct, bound: boundVars, unbound: unboundVars },
      overallScore: overallScore
    };
  });
}

// ─── Feature 10: Layer Organization ───

function analyzeLayerOrganization() {
  var root = figma.currentPage;
  var misordered = [];
  var hiddenLayers = [];
  var emptyGroups = [];
  var deepNesting = [];

  walk(root, function(node) {
    if (node.type === 'PAGE') return;

    // Hidden layers
    try {
      if (node.visible === false) {
        hiddenLayers.push({
          id: node.id, name: node.name, type: node.type, path: nodePath(node)
        });
      }
    } catch (e) {}

    // Empty groups/frames
    if ((node.type === 'GROUP' || node.type === 'FRAME') && 'children' in node && node.children.length === 0) {
      emptyGroups.push({
        id: node.id, name: node.name, type: node.type, path: nodePath(node)
      });
    }

    // Deep nesting check
    var depth = 0;
    var current = node.parent;
    while (current && current.type !== 'PAGE') {
      depth++;
      current = current.parent;
    }
    if (depth > 8) {
      deepNesting.push({
        id: node.id, name: node.name, type: node.type, path: nodePath(node),
        depth: depth
      });
    }
  });

  // Check layer order vs visual position for top-level frames
  var topFrames = root.children;
  for (var i = 0; i < topFrames.length; i++) {
    var frame = topFrames[i];
    if (frame.type !== 'FRAME' || !('children' in frame) || frame.children.length < 2) continue;

    var ch = frame.children;
    for (var j = 1; j < ch.length; j++) {
      var prev = ch[j - 1];
      var curr = ch[j];
      // In Figma, last child is on top visually. If a node that appears lower visually
      // is later in the children array (higher z-index), it may be misordered
      if (curr.y < prev.y - 10 && curr.y + curr.height < prev.y) {
        misordered.push({
          id: curr.id, name: curr.name, type: curr.type, path: nodePath(curr),
          parentId: frame.id, parentName: frame.name,
          issue: curr.name + ' is above ' + prev.name + ' visually but below in layers'
        });
      }
    }
  }

  return {
    misordered: misordered,
    hiddenLayers: hiddenLayers,
    emptyGroups: emptyGroups,
    deepNesting: deepNesting,
    totalIssues: misordered.length + hiddenLayers.length + emptyGroups.length + deepNesting.length
  };
}

// ─── Feature 11: Handoff Annotations ───

function auditAnnotations() {
  var root = figma.currentPage;
  var withAnnotations = [];
  var withoutAnnotations = [];

  walk(root, function(node) {
    if (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET') return;
    if (isVariantComponent(node)) return;

    var hasAnnotation = false;
    try {
      if (node.annotations && node.annotations.length > 0) {
        hasAnnotation = true;
      }
    } catch (e) {}

    // Also check if description serves as annotation
    try {
      if (node.description && node.description.trim().length > 20) {
        hasAnnotation = true;
      }
    } catch (e) {}

    if (hasAnnotation) {
      withAnnotations.push({
        id: node.id, name: node.name, type: node.type, path: nodePath(node)
      });
    } else {
      withoutAnnotations.push({
        id: node.id, name: node.name, type: node.type, path: nodePath(node)
      });
    }
  });

  return {
    withAnnotations: withAnnotations,
    withoutAnnotations: withoutAnnotations,
    annotatedCount: withAnnotations.length,
    unannotatedCount: withoutAnnotations.length
  };
}


// ─── Cleanup Scoring ───

function calculateCleanupScore(detached, unused, coverage, layers, annotations) {
  var deductions = 0;
  deductions += Math.min(detached.length * 2, 15);
  deductions += Math.min(unused.unusedStyles.length * 1, 10);
  deductions += Math.min(unused.unusedVariables.length * 0.5, 10);
  deductions += Math.min((100 - coverage.overallScore) * 0.2, 15);
  deductions += Math.min(layers.totalIssues * 1, 15);
  deductions += Math.min(annotations.unannotatedCount * 1, 10);
  return Math.max(0, Math.round(100 - deductions));
}

// ─── Action Functions ───

function deleteUnusedStyles(styleIds) {
  var deleted = 0;
  var errors = [];
  var promises = [];
  for (var i = 0; i < styleIds.length; i++) {
    (function(sid) {
      promises.push(
        figma.getStyleByIdAsync(sid).then(function(style) {
          if (style) { style.remove(); deleted++; }
          else { errors.push(sid); }
        }).catch(function() { errors.push(sid); })
      );
    })(styleIds[i]);
  }
  return Promise.all(promises).then(function() {
    return { deleted: deleted, errors: errors };
  });
}

function deleteUnusedVariables(variableIds) {
  var deleted = 0;
  var errors = [];
  var promises = [];
  for (var i = 0; i < variableIds.length; i++) {
    (function(vid) {
      promises.push(
        figma.variables.getVariableByIdAsync(vid).then(function(variable) {
          if (variable) { variable.remove(); deleted++; }
          else { errors.push(vid); }
        }).catch(function() { errors.push(vid); })
      );
    })(variableIds[i]);
  }
  return Promise.all(promises).then(function() {
    return { deleted: deleted, errors: errors };
  });
}

function removeHiddenLayers(nodeIds) {
  var removed = 0;
  var errors = [];
  var promises = [];
  for (var i = 0; i < nodeIds.length; i++) {
    (function(nid) {
      promises.push(
        figma.getNodeByIdAsync(nid).then(function(node) {
          if (node && node.visible === false) { node.remove(); removed++; }
          else { errors.push(nid); }
        }).catch(function() { errors.push(nid); })
      );
    })(nodeIds[i]);
  }
  return Promise.all(promises).then(function() {
    return { removed: removed, errors: errors };
  });
}

function removeEmptyGroups(nodeIds) {
  var removed = 0;
  var errors = [];
  var promises = [];
  for (var i = 0; i < nodeIds.length; i++) {
    (function(nid) {
      promises.push(
        figma.getNodeByIdAsync(nid).then(function(node) {
          if (node && 'children' in node && node.children.length === 0) { node.remove(); removed++; }
          else { errors.push(nid); }
        }).catch(function() { errors.push(nid); })
      );
    })(nodeIds[i]);
  }
  return Promise.all(promises).then(function() {
    return { removed: removed, errors: errors };
  });
}

function sortLayersByPosition(nodeId) {
  return figma.getNodeByIdAsync(nodeId).then(function(node) {
    if (!node || !('children' in node) || node.children.length < 2) {
      return { success: false, error: 'Node not found or has fewer than 2 children' };
    }
    var sorted = node.children.slice().sort(function(a, b) {
      return a.y - b.y;
    });
    for (var i = sorted.length - 1; i >= 0; i--) {
      node.appendChild(sorted[i]);
    }
    return { success: true, sorted: sorted.length };
  }).catch(function(e) {
    return { success: false, error: e.message || String(e) };
  });
}

function addAutoAnnotations(nodeIds) {
  var annotated = 0;
  var errors = [];
  var promises = [];
  for (var i = 0; i < nodeIds.length; i++) {
    (function(nid) {
      promises.push(
        figma.getNodeByIdAsync(nid).then(function(node) {
          if (!node || (node.type !== 'COMPONENT' && node.type !== 'COMPONENT_SET')) {
            errors.push(nid); return;
          }
          var desc = buildDescription(node);
          var specs = [];
          specs.push('Size: ' + Math.round(node.width) + 'x' + Math.round(node.height));
          try {
            if (node.layoutMode && node.layoutMode !== 'NONE') {
              specs.push('Layout: ' + node.layoutMode + ', gap: ' + (node.itemSpacing || 0));
              specs.push('Padding: ' + (node.paddingTop || 0) + '/' + (node.paddingRight || 0) + '/' + (node.paddingBottom || 0) + '/' + (node.paddingLeft || 0));
            }
          } catch (e) {}
          try {
            if (node.cornerRadius && typeof node.cornerRadius === 'number') {
              specs.push('Radius: ' + node.cornerRadius);
            }
          } catch (e) {}
          node.description = desc + '\n\nSpecs:\n' + specs.join('\n');
          annotated++;
        }).catch(function() { errors.push(nid); })
      );
    })(nodeIds[i]);
  }
  return Promise.all(promises).then(function() {
    return { annotated: annotated, errors: errors };
  });
}


// ═══════════════════════════════════════════════════════════
// MESSAGE HANDLER
// ═══════════════════════════════════════════════════════════

figma.ui.onmessage = function(msg) {
  switch (msg.type) {
    // ── Audit ──
    case 'run-audit': {
      var auditRoot = null;
      if (msg.scope === 'selection') {
        var auditSel = figma.currentPage.selection;
        if (auditSel.length === 0) {
          figma.ui.postMessage({ type: 'audit-result', error: 'No selection — select a screen or component first.' });
          break;
        }
        auditRoot = auditSel.length === 1 ? auditSel[0] : { type: 'VIRTUAL', children: auditSel };
      }
      var auditResult = auditPage(auditRoot);
      auditResult.scope = msg.scope === 'selection' ? 'selection' : 'page';
      if (msg.scope === 'selection') {
        var auditSel2 = figma.currentPage.selection;
        auditResult.scopeName = auditSel2.length === 1 ? auditSel2[0].name : auditSel2.length + ' selected layers';
      }
      figma.ui.postMessage({ type: 'audit-result', data: auditResult });
      break;
    }

    case 'export-report': {
      var report = generateReport(msg.auditData);
      figma.ui.postMessage({ type: 'export-report-result', data: report });
      break;
    }

    case 'select-nodes': {
      selectNodes(msg.nodeIds).then(function(selectCount) {
        figma.ui.postMessage({ type: 'select-result', count: selectCount });
      });
      break;
    }

    // ── Rename ──
    case 'scan-unnamed': {
      var suggestions = collectUnnamedWithSuggestions();
      figma.ui.postMessage({ type: 'unnamed-result', data: suggestions });
      break;
    }

    case 'batch-rename': {
      batchRename(msg.mappings).then(function(renameResult) {
        figma.ui.postMessage({ type: 'rename-result', data: renameResult });
      });
      break;
    }

    case 'find-replace': {
      var frCount = findAndReplaceNames(msg.find, msg.replace);
      figma.ui.postMessage({ type: 'find-replace-result', count: frCount });
      break;
    }


    case 'generate-descriptions': {
      var descResults = generateDescriptions();
      figma.ui.postMessage({ type: 'descriptions-result', data: descResults });
      break;
    }

    case 'apply-descriptions': {
      applyDescriptions(msg.mappings).then(function(descApplyResult) {
        figma.ui.postMessage({ type: 'apply-descriptions-result', data: descApplyResult });
      });
      break;
    }

    // ── Auto Layout ──
    case 'scan-auto-layout': {
      var alFrames = collectNoAutoLayout();
      figma.ui.postMessage({ type: 'auto-layout-result', data: alFrames });
      break;
    }

    case 'apply-auto-layout': {
      applyAutoLayout(msg.nodeIds, msg.direction, msg.gap, msg.padding).then(function(alResult) {
        figma.ui.postMessage({ type: 'apply-auto-layout-result', data: alResult });
      });
      break;
    }

    // ── MCP Ready ──
    case 'run-mcp-audit': {
      var mcpRoot = null;
      if (msg.scope === 'selection') {
        var sel = figma.currentPage.selection;
        if (sel.length === 0) {
          figma.ui.postMessage({ type: 'mcp-audit-result', error: 'No selection — select a screen or component first.' });
          break;
        }
        if (sel.length === 1) {
          mcpRoot = sel[0];
        } else {
          // Multiple selection: create a virtual walk over all selected nodes
          // Wrap in a temporary object that walk() can handle
          mcpRoot = { type: 'VIRTUAL', children: sel };
        }
      }
      var mcpResult = mcpReadyAudit(mcpRoot);
      mcpResult.scope = msg.scope === 'selection' ? 'selection' : 'page';
      if (msg.scope === 'selection') {
        var sel2 = figma.currentPage.selection;
        mcpResult.scopeName = sel2.length === 1 ? sel2[0].name : sel2.length + ' selected layers';
      }
      figma.ui.postMessage({ type: 'mcp-audit-result', data: mcpResult });
      break;
    }

    // ── MCP Fix ──
    case 'mcp-fix': {
      var fixRoot = null;
      if (msg.scope === 'selection') {
        var fixSel = figma.currentPage.selection;
        if (fixSel.length === 1) fixRoot = fixSel[0];
        else if (fixSel.length > 1) fixRoot = { type: 'VIRTUAL', children: fixSel };
      }

      var fixPromise;
      if (msg.category === 'naming') fixPromise = fixMcpNaming(fixRoot);
      else if (msg.category === 'layout') fixPromise = fixMcpAutoLayout(fixRoot);
      else if (msg.category === 'tokens') fixPromise = fixMcpTokenBinding(fixRoot);
      else if (msg.category === 'spacing') fixPromise = fixMcpSpacing(fixRoot);
      else fixPromise = fixMcpAll(fixRoot);

      fixPromise.then(function(fixResult) {
        figma.ui.postMessage({ type: 'mcp-fix-result', data: fixResult, category: msg.category || 'all' });
      }).catch(function(err) {
        figma.ui.postMessage({ type: 'mcp-fix-result', error: err && err.message ? err.message : String(err) });
      });
      break;
    }

    // ── MCP Generate Prompt ──
    case 'mcp-generate-prompt': {
      var promptRoot = null;
      if (msg.scope === 'selection') {
        var promptSel = figma.currentPage.selection;
        if (promptSel.length === 1) promptRoot = promptSel[0];
        else if (promptSel.length > 1) promptRoot = { type: 'VIRTUAL', children: promptSel };
      }
      var promptFramework = msg.framework || 'expo';
      generatePrompt(promptFramework, promptRoot).then(function(result) {
        figma.ui.postMessage({ type: 'mcp-prompt-result', data: result });
      }).catch(function(err) {
        figma.ui.postMessage({ type: 'mcp-prompt-result', error: err && err.message ? err.message : String(err) });
      });
      break;
    }

    // ── MCP Auto-Detect Intents ──
    case 'mcp-auto-detect-intents': {
      var intentRoot = null;
      if (msg.scope === 'selection') {
        var intentSel = figma.currentPage.selection;
        if (intentSel.length === 1) intentRoot = intentSel[0];
        else if (intentSel.length > 1) intentRoot = { type: 'VIRTUAL', children: intentSel };
      }
      var detections = autoDetectIntents(intentRoot);
      figma.ui.postMessage({ type: 'mcp-intents-result', data: detections });
      break;
    }

    // ── MCP Batch Set Intents ──
    case 'mcp-batch-set-intents': {
      batchSetIntents(msg.mappings).then(function(result) {
        figma.ui.postMessage({ type: 'mcp-batch-intents-result', data: result });
      }).catch(function(err) {
        figma.ui.postMessage({ type: 'mcp-batch-intents-result', error: err && err.message ? err.message : String(err) });
      });
      break;
    }

    // ── MCP Set Intent ──
    case 'mcp-set-intent': {
      setNodeIntent(msg.nodeId, msg.intent).then(function(result) {
        figma.ui.postMessage({ type: 'mcp-set-intent-result', data: result });
      }).catch(function(err) {
        figma.ui.postMessage({ type: 'mcp-set-intent-result', error: err && err.message ? err.message : String(err) });
      });
      break;
    }

    // ── MCP Set Responsive ──
    case 'mcp-set-responsive': {
      setResponsiveHint(msg.nodeId, msg.hints).then(function(result) {
        figma.ui.postMessage({ type: 'mcp-set-responsive-result', data: result });
      }).catch(function(err) {
        figma.ui.postMessage({ type: 'mcp-set-responsive-result', error: err && err.message ? err.message : String(err) });
      });
      break;
    }

    // ── MCP Clear Responsive ──
    case 'mcp-clear-responsive': {
      var clearNodeId = msg.nodeId;
      clearResponsiveHint(clearNodeId).then(function(result) {
        figma.ui.postMessage({ type: 'mcp-clear-responsive-result', data: result, nodeId: clearNodeId });
      }).catch(function(err) {
        figma.ui.postMessage({ type: 'mcp-clear-responsive-result', error: err && err.message ? err.message : String(err), nodeId: clearNodeId });
      });
      break;
    }

    // ── MCP Get Selection Data ──
    case 'mcp-get-selection-data': {
      var selNodes = figma.currentPage.selection;
      if (selNodes.length === 0) {
        figma.ui.postMessage({ type: 'mcp-selection-data-result', error: 'No selection' });
        break;
      }
      var selNode = selNodes[0];
      var respHints = {};
      try {
        var respData = selNode.getPluginData('mcp-responsive');
        if (respData && respData !== '') respHints = JSON.parse(respData);
      } catch (e) {}
      figma.ui.postMessage({
        type: 'mcp-selection-data-result',
        data: {
          id: selNode.id,
          name: selNode.name,
          type: selNode.type,
          hints: respHints
        }
      });
      break;
    }


    // ── Cleanup ──
    case 'run-cleanup': {
      var detached = findDetachedInstances();
      var layers = analyzeLayerOrganization();
      var annotations = auditAnnotations();
      Promise.all([findUnusedStyles(), analyzeDesignSystemCoverage()]).then(function(asyncResults) {
        var unused = asyncResults[0];
        var coverage = asyncResults[1];
        var cleanupScore = calculateCleanupScore(detached, unused, coverage, layers, annotations);
        figma.ui.postMessage({
          type: 'cleanup-result',
          data: {
            detached: detached,
            unusedStyles: unused,
            coverage: coverage,
            layers: layers,
            annotations: annotations,
            score: cleanupScore
          }
        });
      }).catch(function(err) {
        figma.ui.postMessage({
          type: 'cleanup-result',
          error: err && err.message ? err.message : String(err)
        });
      });
      break;
    }

    case 'delete-unused-styles': {
      deleteUnusedStyles(msg.styleIds).then(function(dsResult) {
        figma.ui.postMessage({ type: 'delete-styles-result', data: dsResult });
      }).catch(function(err) {
        figma.ui.postMessage({ type: 'delete-styles-result', error: err && err.message ? err.message : String(err) });
      });
      break;
    }

    case 'delete-unused-variables': {
      deleteUnusedVariables(msg.variableIds).then(function(dvResult) {
        figma.ui.postMessage({ type: 'delete-variables-result', data: dvResult });
      }).catch(function(err) {
        figma.ui.postMessage({ type: 'delete-variables-result', error: err && err.message ? err.message : String(err) });
      });
      break;
    }

    case 'remove-hidden-layers': {
      removeHiddenLayers(msg.nodeIds).then(function(rhResult) {
        figma.ui.postMessage({ type: 'remove-hidden-result', data: rhResult });
      }).catch(function(err) {
        figma.ui.postMessage({ type: 'remove-hidden-result', error: err && err.message ? err.message : String(err) });
      });
      break;
    }

    case 'remove-empty-groups': {
      removeEmptyGroups(msg.nodeIds).then(function(reResult) {
        figma.ui.postMessage({ type: 'remove-empty-result', data: reResult });
      }).catch(function(err) {
        figma.ui.postMessage({ type: 'remove-empty-result', error: err && err.message ? err.message : String(err) });
      });
      break;
    }

    case 'sort-layers-by-position': {
      sortLayersByPosition(msg.nodeId).then(function(slResult) {
        figma.ui.postMessage({ type: 'sort-layers-result', data: slResult });
      }).catch(function(err) {
        figma.ui.postMessage({ type: 'sort-layers-result', error: err && err.message ? err.message : String(err) });
      });
      break;
    }

    case 'add-auto-annotations': {
      addAutoAnnotations(msg.nodeIds).then(function(aaResult) {
        figma.ui.postMessage({ type: 'add-annotations-result', data: aaResult });
      }).catch(function(err) {
        figma.ui.postMessage({ type: 'add-annotations-result', error: err && err.message ? err.message : String(err) });
      });
      break;
    }

    case 'close': {
      figma.closePlugin();
      break;
    }
  }
};
