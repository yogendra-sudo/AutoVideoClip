/**
 * Browser「Translate this page」（Chrome / Edge / Safari）It will put the text nodesReplaceComplete <font> Translation of the package。
 * React Then do the following to these nodes removeChild / insertBefore Time，The node is no longerGet it from theUnder the parent node it records，
 * Browser throws NotFoundError，The whole tree is ErrorBoundary Uninstall（issue #100：Docker Web In mode
 * OverseasUser has translation toggle on LLM ProviderInstant collapse）。
 *
 * Put these two here. DOM ActionsDowngraded to「The node has been moved by an external script → Skip / Append to the end」，
 * The downside is that the translation may retain old text.，But the page won't crash completely.。The approach is the same. facebook/react#11538 OfficialSuggested。
 */

const GUARD_FLAG = '__autovideoclipDomTranslationGuard'

export function isPageTranslated(): boolean {
  if (typeof document === 'undefined') return false
  const html = document.documentElement
  return (
    html.classList.contains('translated-ltr') ||
    html.classList.contains('translated-rtl') ||
    // Safari / Departmentpoints Chrome VersionDo not add class，Can only be injected through translation <font> Structure judgment
    !!document.querySelector('font[style*="vertical-align: inherit"] > font')
  )
}

export function isDomDisplacementError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '')
  return (
    /removeChild|insertBefore/.test(message) &&
    /not a child of this node|NotFoundError/i.test(message)
  )
}

export function installDomTranslationGuard(): void {
  if (typeof Node === 'undefined') return
  const proto = Node.prototype as Node & Record<string, unknown>
  if (proto[GUARD_FLAG]) return
  proto[GUARD_FLAG] = true

  const originalRemoveChild = Node.prototype.removeChild
  Node.prototype.removeChild = function removeChild<T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      if (import.meta.env.DEV) {
        console.warn('[dom-guard] removeChild Skip：The node has been moved by external scripts such as page translation', child)
      }
      return child
    }
    return originalRemoveChild.call(this, child) as T
  }

  const originalInsertBefore = Node.prototype.insertBefore
  Node.prototype.insertBefore = function insertBefore<T extends Node>(
    this: Node,
    newNode: T,
    referenceNode: Node | null,
  ): T {
    if (referenceNode && referenceNode.parentNode !== this) {
      if (import.meta.env.DEV) {
        console.warn('[dom-guard] insertBefore The reference node has been moved，ChangeTo append to the end', referenceNode)
      }
      return originalInsertBefore.call(this, newNode, null) as T
    }
    return originalInsertBefore.call(this, newNode, referenceNode) as T
  }
}
