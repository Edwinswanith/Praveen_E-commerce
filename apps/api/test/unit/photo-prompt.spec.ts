import { buildPhotoPrompt, type PhotoSubject } from '../../src/modules/ai/image-gen.service';

const base: PhotoSubject = { name: 'Oversized Cotton Tee', gender: 'MEN', category: 'T-Shirts', color: 'Black', description: 'Heavyweight tee.', attributes: { fabric: '100% Cotton', fit: 'Oversized' } };

describe('AI photo prompts', () => {
  it('describes the real product and forbids text/logos', () => {
    const { prompt, style } = buildPhotoPrompt(base, 'MODEL', { hasReference: false });
    expect(style).toBe('MODEL');
    expect(prompt).toContain('a young Indian man wearing a black oversized cotton tee (100% cotton, oversized fit)');
    expect(prompt).toMatch(/no watermark, no brand logos/);
  });
  it('never puts kids clothing on a generated child', () => {
    expect(buildPhotoPrompt({ ...base, gender: 'KIDS' }, 'MODEL', { hasReference: false }).style).toBe('STUDIO');
    expect(buildPhotoPrompt({ ...base, gender: 'KIDS' }, 'LIFESTYLE', { hasReference: false }).prompt).not.toMatch(/wearing/);
  });
  it('locks the garment when restyling a real photo', () => {
    expect(buildPhotoPrompt(base, 'STUDIO', { hasReference: true }).prompt).toMatch(/Do not redesign, recolour/);
  });
});

describe('MARKETPLACE style (main listing image)', () => {
  it('asks for a pure white background, product only, filling the frame', () => {
    const { prompt, style } = buildPhotoPrompt(base, 'MARKETPLACE', { hasReference: true });
    expect(style).toBe('MARKETPLACE');
    expect(prompt).toMatch(/pure white \(#FFFFFF\)/);
    expect(prompt).toMatch(/85% of the frame/);
    expect(prompt).toMatch(/no person/);
    expect(prompt).not.toMatch(/wearing/);
    expect(prompt).toMatch(/Reproduce that product EXACTLY/);
  });
  it('is allowed for kids products (no model involved)', () => {
    const r = buildPhotoPrompt({ ...base, gender: 'KIDS' }, 'MARKETPLACE', { hasReference: true });
    expect(r.style).toBe('MARKETPLACE');
    expect(r.prompt).not.toMatch(/wearing|young Indian/);
  });
});
