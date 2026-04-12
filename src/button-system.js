function splitTokens(className) {
  return String(className || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function dedupeLastWins(tokens) {
  const seen = new Set();
  const out = [];
  for (let i = tokens.length - 1; i >= 0; i -= 1) {
    const t = tokens[i];
    if (seen.has(t)) continue;
    seen.add(t);
    out.unshift(t);
  }
  return out;
}

function normalizeModifiers(input) {
  if (Array.isArray(input)) return input.map(v => String(v).trim()).filter(Boolean);
  if (typeof input === 'string') {
    return input
      .split(',')
      .map(v => v.trim())
      .filter(Boolean);
  }
  return [];
}

function hasToken(tokens, token) {
  return tokens.includes(token);
}

function addToken(tokens, token) {
  if (!tokens.includes(token)) tokens.push(token);
}

function removeTokensByPredicate(tokens, predicate) {
  return tokens.filter(t => !predicate(t));
}

function detectHardcodedColorTokens(tokens) {
  const hardcoded = [];
  for (const t of tokens) {
    if (/^(text|bg|border)-\[[^\]]+\]$/.test(t)) hardcoded.push(t);
    else if (/^(text|bg|border)-(white|black)(\/\d+)?$/.test(t)) hardcoded.push(t);
  }
  return hardcoded;
}

function normalizeVariant(v) {
  const raw = String(v || 'primary').trim().toLowerCase();
  if (raw === 'primary' || raw === 'outline' || raw === 'ghost') return raw;
  return 'primary';
}

function buildButtonClassFramework(args = {}) {
  const variant = normalizeVariant(args.variant);
  const shape = String(args.shape || 'rounded-box').trim();
  const size = String(args.size || 'md').trim().toLowerCase();
  const responsive = args.responsive !== false;
  const cta = args.cta !== false;
  const includeModifiers = args.includeModifiers !== false;
  const emphasis = String(args.emphasis || 'default').trim().toLowerCase();
  const extraClasses = String(args.extraClasses || '').trim();

  const classes = [];
  const activeModifiers = [];

  addToken(classes, 'btn');

  if (variant === 'outline') {
    addToken(classes, 'btn-outline');
    if (cta) {
      addToken(classes, shape);
      addToken(classes, 'px-space-md');
      addToken(classes, 'py-space-xs');
      addToken(classes, 'min-h-12');
      addToken(classes, 'font-semibold');
      addToken(classes, 'border-base-content/30');
      addToken(classes, 'text-base-content');
      addToken(classes, 'bg-transparent');
      if (responsive) {
        addToken(classes, 'w-full');
        addToken(classes, 'md:w-auto');
      }
      if (includeModifiers) activeModifiers.push('cta-outline-responsive');
    }
  } else if (variant === 'ghost') {
    addToken(classes, 'btn-ghost');
    addToken(classes, shape);
  } else {
    addToken(classes, 'btn-primary');
    if (cta) {
      addToken(classes, shape);
      addToken(classes, 'px-space-md');
      addToken(classes, 'py-space-xs');
      addToken(classes, 'min-h-12');
      addToken(classes, 'font-semibold');
      if (responsive) {
        addToken(classes, 'w-full');
        addToken(classes, 'md:w-auto');
      }
      if (includeModifiers) activeModifiers.push('cta-responsive');
    }
    if (emphasis === 'neon') {
      addToken(classes, 'btn-neon');
      addToken(classes, 'bg-[linear-gradient(180deg,rgba(124,58,237,0.4),rgba(34,211,238,0.1))]');
      addToken(classes, 'text-white');
      addToken(classes, 'border');
      if (includeModifiers) activeModifiers.push('btn-neon');
    }
  }

  if (size === 'sm') {
    addToken(classes, 'min-h-10');
    addToken(classes, 'text-sm');
  } else if (size === 'lg') {
    addToken(classes, 'min-h-14');
    addToken(classes, 'text-base');
  }

  if (extraClasses) classes.push(...splitTokens(extraClasses));

  return {
    variant,
    className: dedupeLastWins(classes).join(' '),
    activeModifiers: dedupeLastWins(activeModifiers),
  };
}

function validateButtonClasses(args = {}) {
  const classNameInput = args.className || args.classNamePatch || args.class || '';
  const autoFix = args.autoFix !== false;
  const variantHint = args.intentVariant ? normalizeVariant(args.intentVariant) : null;
  const allowCustomClasses = args.allowCustomClasses !== false;
  const modifiers = normalizeModifiers(args.activeModifiers);

  let tokens = splitTokens(classNameInput);
  let nextModifiers = [...modifiers];
  const issues = [];
  const fixes = [];

  const addIssue = (code, severity, message) => issues.push({ code, severity, message });

  if (!hasToken(tokens, 'btn')) {
    addIssue('missing-btn', 'error', 'Button class is missing `btn` base class.');
    if (autoFix) {
      tokens.unshift('btn');
      fixes.push('Added `btn` base class.');
    }
  }

  const hasOutline = hasToken(tokens, 'btn-outline');
  const hasPrimary = hasToken(tokens, 'btn-primary');
  let inferredVariant = hasOutline ? 'outline' : hasPrimary ? 'primary' : 'custom';

  if (hasOutline && hasPrimary) {
    addIssue('variant-conflict', 'error', '`btn-outline` and `btn-primary` are both present.');
    if (autoFix && variantHint) {
      if (variantHint === 'outline') {
        tokens = tokens.filter(t => t !== 'btn-primary');
        fixes.push('Removed `btn-primary` to honor outline intent.');
      } else if (variantHint === 'primary') {
        tokens = tokens.filter(t => t !== 'btn-outline');
        fixes.push('Removed `btn-outline` to honor primary intent.');
      }
    }
  }

  if (variantHint && inferredVariant !== 'custom' && inferredVariant !== variantHint) {
    addIssue(
      'intent-mismatch',
      'warn',
      `Current classes infer variant \`${inferredVariant}\`, but intent requested \`${variantHint}\`.`
    );
    if (autoFix) {
      if (variantHint === 'outline') {
        tokens = tokens.filter(t => t !== 'btn-primary');
        addToken(tokens, 'btn-outline');
        inferredVariant = 'outline';
        fixes.push('Aligned classes to outline intent.');
      } else if (variantHint === 'primary') {
        tokens = tokens.filter(t => t !== 'btn-outline');
        addToken(tokens, 'btn-primary');
        inferredVariant = 'primary';
        fixes.push('Aligned classes to primary intent.');
      }
    }
  }

  if (inferredVariant === 'outline' || variantHint === 'outline') {
    if (!hasToken(tokens, 'btn-outline')) {
      addIssue('missing-outline', 'error', 'Outline button is missing `btn-outline`.');
      if (autoFix) {
        addToken(tokens, 'btn-outline');
        fixes.push('Added `btn-outline`.');
      }
    }
    if (!hasToken(tokens, 'border-base-content/30')) {
      addIssue('outline-border-token', 'warn', 'Outline button should use `border-base-content/30`.');
      if (autoFix) {
        addToken(tokens, 'border-base-content/30');
        fixes.push('Added `border-base-content/30`.');
      }
    }
    if (!hasToken(tokens, 'text-base-content')) {
      addIssue('outline-text-token', 'warn', 'Outline button should use `text-base-content`.');
      if (autoFix) {
        addToken(tokens, 'text-base-content');
        fixes.push('Added `text-base-content`.');
      }
    }
    if (!hasToken(tokens, 'bg-transparent')) {
      addIssue('outline-bg', 'warn', 'Outline button should be transparent by default.');
      if (autoFix) {
        addToken(tokens, 'bg-transparent');
        fixes.push('Added `bg-transparent`.');
      }
    }

    const disallowedFill = tokens.filter(
      t =>
        /^bg-(primary|secondary|accent|neutral)\b/.test(t) ||
        /^bg-\[/.test(t) ||
        t === 'text-white' ||
        /^border-white(\/\d+)?$/.test(t)
    );
    if (disallowedFill.length > 0) {
      addIssue(
        'outline-fill-conflict',
        'warn',
        `Outline button has fill/ink override classes: ${disallowedFill.join(', ')}.`
      );
      if (autoFix) {
        tokens = removeTokensByPredicate(
          tokens,
          t =>
            /^bg-(primary|secondary|accent|neutral)\b/.test(t) ||
            /^bg-\[/.test(t) ||
            t === 'text-white' ||
            /^border-white(\/\d+)?$/.test(t)
        );
        fixes.push('Removed outline fill/ink override classes.');
      }
    }

    if (nextModifiers.includes('btn-neon')) {
      addIssue('outline-neon-modifier', 'warn', 'Outline button should not keep `btn-neon` active.');
      if (autoFix) {
        nextModifiers = nextModifiers.filter(m => m !== 'btn-neon');
        fixes.push('Removed `btn-neon` from active modifiers.');
      }
    }
  }

  if (inferredVariant === 'primary' || variantHint === 'primary') {
    if (!hasToken(tokens, 'btn-primary')) {
      addIssue('missing-primary', 'error', 'Primary button is missing `btn-primary`.');
      if (autoFix) {
        addToken(tokens, 'btn-primary');
        fixes.push('Added `btn-primary`.');
      }
    }
    if (hasToken(tokens, 'btn-outline')) {
      addIssue('primary-outline-conflict', 'warn', 'Primary button should not include `btn-outline`.');
      if (autoFix) {
        tokens = tokens.filter(t => t !== 'btn-outline');
        fixes.push('Removed `btn-outline` from primary button.');
      }
    }
    const hasCtaSizing =
      hasToken(tokens, 'px-space-md') &&
      hasToken(tokens, 'py-space-xs') &&
      (hasToken(tokens, 'min-h-12') || hasToken(tokens, 'min-h-10'));
    if (!hasCtaSizing) {
      addIssue(
        'cta-sizing-missing',
        'info',
        'Consider CTA sizing tokens: `px-space-md py-space-xs min-h-12`.'
      );
    }
  }

  const hardcodedColorTokens = detectHardcodedColorTokens(tokens);
  if (hardcodedColorTokens.length > 0) {
    const severity = allowCustomClasses ? 'warn' : 'error';
    addIssue(
      'hardcoded-colors',
      severity,
      `Hardcoded color classes found: ${hardcodedColorTokens.join(', ')}. Prefer design tokens.`
    );
  }

  return {
    ok: !issues.some(i => i.severity === 'error'),
    inferredVariant,
    className: dedupeLastWins(tokens).join(' '),
    activeModifiers: dedupeLastWins(nextModifiers),
    issues,
    appliedFixes: fixes,
  };
}

module.exports = {
  buildButtonClassFramework,
  validateButtonClasses,
};

