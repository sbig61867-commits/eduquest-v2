/**
 * Device-environment hints for a proctored attempt — recorded once for the
 * teacher as `environment_flag` events (info, never violations).
 *
 * Tools that hide a virtual machine from lockdown software exist and work (see
 * the CloakBox project), so none of this is proof or protection. It is a cheap
 * hint that costs nothing and catches the careless case:
 *   • a virtual / software GPU (VirtualBox, VMware, Parallels, QEMU, Hyper-V,
 *     or CPU rendering such as SwiftShader / llvmpipe);
 *   • a second screen attached (Window Management API, Chromium);
 *   • a browser driven by automation (navigator.webdriver).
 */

const VIRTUAL_GPU_RE = /(virtualbox|vmware|parallels|qemu|virgl|virtio|hyper-v|microsoft basic render|llvmpipe|softpipe|swiftshader|bochs)/i

export interface EnvironmentFacts {
  renderer?: string | null
  isExtended?: boolean | null
  webdriver?: boolean | null
}

export function environmentFlags(facts: EnvironmentFacts): string[] {
  const flags: string[] = []
  if (facts.renderer && VIRTUAL_GPU_RE.test(facts.renderer)) flags.push(`virtual or software graphics: ${facts.renderer.slice(0, 120)}`)
  if (facts.isExtended === true) flags.push('a second screen is connected')
  if (facts.webdriver === true) flags.push('the browser is controlled by automation software')
  return flags
}

/** Reads the facts in the browser. Every probe is best-effort and never throws. */
export function readEnvironmentFacts(): EnvironmentFacts {
  const facts: EnvironmentFacts = {}
  try {
    const gl = document.createElement('canvas').getContext('webgl') as WebGLRenderingContext | null
    const info = gl?.getExtension('WEBGL_debug_renderer_info')
    if (gl && info) facts.renderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '')
  } catch { /* no WebGL */ }
  try {
    const ext = (window.screen as Screen & { isExtended?: boolean }).isExtended
    if (typeof ext === 'boolean') facts.isExtended = ext
  } catch { /* not supported */ }
  try { facts.webdriver = navigator.webdriver === true } catch { /* ignore */ }
  return facts
}
