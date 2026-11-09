// The shared enums of the server SDKs (change 12, D5): GoalKind, GoalStatus and Provider, written for every
// language from openapi.json's components. Provider is every gateway in GET /v1/payment-gateways (enabled or
// not) plus shopify, woocommerce and custom, so a new gateway on the backend shows up as drift in --check.
//
// generate.mjs calls enumSources() for each language and writes (or, with --check, compares) the files.

/** The enums, in the order they are written. `doc` is the one-line summary used in every language. */
export const ENUMS = [
  { name: 'GoalKind', doc: "A goal's kind, set in the goal's settings (never in a goal call): `standard` or `payment`." },
  { name: 'GoalStatus', doc: "A goal call's outcome: `counted`, `waiting` (a Payment goal awaiting confirmation), `received` (not counted) or `refused`." },
  { name: 'Provider', doc: 'A payment provider: every gateway in `GET /v1/payment-gateways`, plus `shopify`, `woocommerce` and `custom`.' },
];

/** Read the enum values from the (unfiltered) spec; fail loudly when one is missing or malformed. */
export function enumValues(spec) {
  const schemas = spec?.components?.schemas ?? {};
  const out = {};
  for (const { name } of ENUMS) {
    const values = schemas[name]?.enum;
    if (!Array.isArray(values) || values.length === 0 || !values.every((v) => typeof v === 'string' && /^[a-z][a-z0-9_]*$/.test(v))) {
      throw new Error(`openapi.json has no string enum components.schemas.${name}`);
    }
    out[name] = values;
  }
  return out;
}

const pascal = (v) => v.split('_').map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('');
const upper = (v) => v.toUpperCase();

function node(values, header) {
  const lines = [`// ${header[0]}`, `// ${header[1]}`, ''];
  for (const { name, doc } of ENUMS) {
    lines.push(`/** ${doc} */`);
    lines.push(`export const ${name} = {`);
    for (const v of values[name]) lines.push(`  ${pascal(v)}: '${v}',`);
    lines.push('} as const;');
    lines.push(`/** ${doc} */`);
    lines.push(`export type ${name} = (typeof ${name})[keyof typeof ${name}];`);
    lines.push('');
  }
  return { 'node/src/enums.ts': lines.join('\n') };
}

function python(values, header) {
  const lines = [
    `# ${header[0]}`,
    `# ${header[1]}`,
    '"""The shared enums: ``GoalKind``, ``GoalStatus`` and ``Provider``.',
    '',
    'Each member is also a ``str`` equal to its wire value (``GoalStatus.COUNTED == "counted"``), so results stay',
    'plain JSON. A value this SDK version doesn\'t know is kept as a plain string.',
    '"""',
    '',
    'from __future__ import annotations',
    '',
    'from enum import Enum',
    '',
    '__all__ = [' + ENUMS.map((e) => `"${e.name}"`).join(', ') + ']',
    '',
  ];
  for (const { name, doc } of ENUMS) {
    lines.push('');
    lines.push(`class ${name}(str, Enum):`);
    lines.push(`    """${doc.replace(/`/g, '``')}"""`);
    lines.push('');
    for (const v of values[name]) lines.push(`    ${upper(v)} = "${v}"`);
    lines.push('');
    lines.push('    def __str__(self) -> str:');
    lines.push('        return str(self.value)');
    lines.push('');
  }
  return { 'python/src/clikgate/_enums.py': lines.join('\n') };
}

function php(values, header) {
  const out = {};
  for (const { name, doc } of ENUMS) {
    const lines = [
      '<?php',
      '',
      `// ${header[0]}`,
      `// ${header[1]}`,
      '',
      'declare(strict_types=1);',
      '',
      'namespace Clikgate\\Enum;',
      '',
      `/** ${doc} */`,
      `enum ${name}: string`,
      '{',
      ...values[name].map((v) => `    case ${pascal(v)} = '${v}';`),
      '}',
      '',
    ];
    out[`php/src/Enum/${name}.php`] = lines.join('\n');
  }
  return out;
}

function java(values, header) {
  const out = {};
  const pkg = 'java/clikgate-java/src/main/java/com/clikgate/model';
  for (const { name, doc } of ENUMS) {
    const javadoc = doc.replace(/`([^`]*)`/g, '{@code $1}');
    const vals = values[name];
    if (name === 'Provider') {
      // A class, not an enum: a gateway added after this release is still a Provider (fromString).
      out[`${pkg}/${name}.java`] = [
        `// ${header[0]}`,
        `// ${header[1]}`,
        'package com.clikgate.model;',
        '',
        'import java.util.Arrays;',
        'import java.util.Collections;',
        'import java.util.List;',
        'import org.jspecify.annotations.Nullable;',
        '',
        '/**',
        ` * ${javadoc}`,
        ' *',
        ' * <p>{@link #fromString(String)} accepts a provider added after this SDK release (the API validates it).',
        ' */',
        'public final class Provider {',
        ...vals.map((v) => `  public static final Provider ${upper(v)} = new Provider("${v}");`),
        '',
        '  private static final List<Provider> VALUES =',
        `      Collections.unmodifiableList(Arrays.asList(${vals.map(upper).join(', ')}));`,
        '',
        '  private final String value;',
        '',
        '  private Provider(String value) {',
        '    this.value = value;',
        '  }',
        '',
        '  /** The providers this SDK release knows. */',
        '  public static List<Provider> values() {',
        '    return VALUES;',
        '  }',
        '',
        '  /** The provider with this wire value: a known constant, or a new one for a newer gateway. */',
        '  public static Provider fromString(String value) {',
        '    for (Provider p : VALUES) {',
        '      if (p.value.equals(value)) {',
        '        return p;',
        '      }',
        '    }',
        '    return new Provider(value);',
        '  }',
        '',
        '  /** The wire value, e.g. {@code paystack}. */',
        '  public String getValue() {',
        '    return value;',
        '  }',
        '',
        '  @Override',
        '  public String toString() {',
        '    return value;',
        '  }',
        '',
        '  @Override',
        '  public boolean equals(@Nullable Object o) {',
        '    return o instanceof Provider && ((Provider) o).value.equals(value);',
        '  }',
        '',
        '  @Override',
        '  public int hashCode() {',
        '    return value.hashCode();',
        '  }',
        '}',
        '',
      ].join('\n');
      continue;
    }
    out[`${pkg}/${name}.java`] = [
      `// ${header[0]}`,
      `// ${header[1]}`,
      'package com.clikgate.model;',
      '',
      'import org.jspecify.annotations.Nullable;',
      '',
      `/** ${javadoc} */`,
      `public enum ${name} {`,
      vals.map((v) => `  ${upper(v)}("${v}")`).join(',\n') + ';',
      '',
      '  private final String value;',
      '',
      `  ${name}(String value) {`,
      '    this.value = value;',
      '  }',
      '',
      '  /** The wire value. */',
      '  public String getValue() {',
      '    return value;',
      '  }',
      '',
      '  @Override',
      '  public String toString() {',
      '    return value;',
      '  }',
      '',
      `  /** The constant for a wire value, or null when this SDK version doesn't know it. */`,
      `  public static @Nullable ${name} fromValue(@Nullable String value) {`,
      `    for (${name} k : values()) {`,
      '      if (k.value.equals(value)) {',
      '        return k;',
      '      }',
      '    }',
      '    return null;',
      '  }',
      '}',
      '',
    ].join('\n');
  }
  return out;
}

function dotnet(values, header) {
  const xml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/`([^`]*)`/g, '<c>$1</c>');
  const lines = [
    `// ${header[0]}`,
    `// ${header[1]}`,
    '#nullable enable',
    'using System;',
    'using System.Collections.Generic;',
    'using System.Diagnostics.CodeAnalysis;',
    '',
    'namespace Clikgate;',
    '',
  ];
  for (const { name, doc } of ENUMS.filter((e) => e.name !== 'Provider')) {
    lines.push(`/// <summary>${xml(doc)}</summary>`);
    lines.push('[SuppressMessage("Naming", "CA1707", Justification = "Upper-case members, as in the other Clikgate SDKs.")]');
    lines.push(`public enum ${name}`);
    lines.push('{');
    for (const v of values[name]) lines.push(`    /// <summary><c>${v}</c></summary>`, `    ${upper(v)},`);
    lines.push('}');
    lines.push('');
  }
  const p = values.Provider;
  lines.push(
    `/// <summary>${xml(ENUMS[2].doc)} <see cref="FromString"/> accepts a provider added after this SDK release (the API validates it).</summary>`,
    '[SuppressMessage("Naming", "CA1707", Justification = "Upper-case members, as in the other Clikgate SDKs.")]',
    'public readonly struct Provider : IEquatable<Provider>',
    '{',
    ...p.flatMap((v) => [`    /// <summary><c>${v}</c></summary>`, `    public static readonly Provider ${upper(v)} = new("${v}");`]),
    '',
    '    private static readonly Provider[] Known = [' + p.map(upper).join(', ') + '];',
    '',
    '    private Provider(string value) => Value = value;',
    '',
    '    /// <summary>The wire value, e.g. <c>paystack</c>.</summary>',
    '    public string Value { get; }',
    '',
    '    /// <summary>The providers this SDK release knows.</summary>',
    '    public static IReadOnlyList<Provider> Values => Known;',
    '',
    '    /// <summary>The provider with this wire value: a known constant, or a new one for a newer gateway.</summary>',
    '    public static Provider FromString(string value)',
    '    {',
    '        foreach (var known in Known)',
    '        {',
    '            if (known.Value == value)',
    '            {',
    '                return known;',
    '            }',
    '        }',
    '',
    '        return new Provider(value);',
    '    }',
    '',
    '    /// <summary>A provider from its wire value (<c>Provider = "paystack"</c>).</summary>',
    '    public static implicit operator Provider(string value) => FromString(value);',
    '',
    '    /// <inheritdoc/>',
    '    public bool Equals(Provider other) => string.Equals(Value, other.Value, StringComparison.Ordinal);',
    '',
    '    /// <inheritdoc/>',
    '    public override bool Equals(object? obj) => obj is Provider other && Equals(other);',
    '',
    '    /// <inheritdoc/>',
    '    public override int GetHashCode() => Value is null ? 0 : StringComparer.Ordinal.GetHashCode(Value);',
    '',
    '    /// <summary>The wire value.</summary>',
    '    public override string ToString() => Value ?? string.Empty;',
    '',
    '    /// <summary>Equal wire values.</summary>',
    '    public static bool operator ==(Provider left, Provider right) => left.Equals(right);',
    '',
    '    /// <summary>Different wire values.</summary>',
    '    public static bool operator !=(Provider left, Provider right) => !left.Equals(right);',
    '}',
    '',
    '/// <summary>Wire values of <see cref="GoalKind"/> and <see cref="GoalStatus"/>.</summary>',
    'public static class ClikgateEnums',
    '{',
  );
  for (const { name } of ENUMS.filter((e) => e.name !== 'Provider')) {
    lines.push(
      `    /// <summary>The wire value of a <see cref="${name}"/>, e.g. <c>${values[name][values[name].length - 1]}</c>.</summary>`,
      `    public static string ToWire(this ${name} value) => value switch`,
      '    {',
      ...values[name].map((v) => `        ${name}.${upper(v)} => "${v}",`),
      '        _ => throw new ArgumentOutOfRangeException(nameof(value)),',
      '    };',
      '',
      `    /// <summary>The <see cref="${name}"/> for a wire value, or null when this SDK version doesn't know it.</summary>`,
      `    public static ${name}? Parse${name}(string? value) => value switch`,
      '    {',
      ...values[name].map((v) => `        "${v}" => ${name}.${upper(v)},`),
      '        _ => null,',
      '    };',
      '',
    );
  }
  lines.pop();
  lines.push('}', '');
  return { 'dotnet/src/Clikgate/Enums.cs': lines.join('\n') };
}

const WRITERS = { node, python, php, java, dotnet };

/** The enum files of one language, keyed by path relative to server/. */
export function enumSources(lang, values, specSha) {
  const writer = WRITERS[lang];
  if (!writer) return {};
  const header = [
    'Generated by server/codegen/generate.mjs from openapi.json (GoalKind, GoalStatus, Provider). Do not edit by hand.',
    `Source sha256 ${specSha}.`,
  ];
  return writer(values, header);
}
