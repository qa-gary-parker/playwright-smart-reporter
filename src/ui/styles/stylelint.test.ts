import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import stylelint from 'stylelint';

const config = JSON.parse(readFileSync('.stylelintrc.json', 'utf8'));

describe('stylelint design rules', () => {
  it('flags each banned pattern in the violations fixture', async () => {
    const { results } = await stylelint.lint({
      files: 'src/ui/styles/__fixtures__/violations.css',
      config: { ...config, ignoreFiles: [] },
    });
    const found = results[0].warnings.map((w) => `${w.line}:${w.rule}`).sort();
    expect(found).toEqual(
      [
        '2:color-no-hex',
        '6:color-named',
        '10:function-disallowed-list',
        '14:declaration-property-value-allowed-list',
        '18:property-disallowed-list',
        '22:declaration-property-value-allowed-list',
        '26:declaration-property-value-allowed-list',
        '30:declaration-property-value-allowed-list',
        '34:declaration-property-value-disallowed-list',
        '35:property-disallowed-list',
        '39:declaration-property-value-allowed-list',
      ].sort(),
    );
  });
});
