import { forwardRef } from "react"

type Props = {
  onChoose: (files: FileList) => void
  directory?: boolean
}

// Hidden file / folder picker triggered programmatically by a Button click.
// Clears value after each selection so the same file can be picked again in a
// row — without this, the browser sees "no change" and skips the change event.
export const HiddenFileInput = forwardRef<HTMLInputElement, Props>(
  ({ onChoose, directory }, ref) => (
    <input
      ref={ref}
      type="file"
      multiple
      hidden
      // webkitdirectory is non-standard; TS doesn't type it on HTMLInputElement.
      // The attribute name is lowercase in the DOM even though React accepts camelCase.
      // @ts-expect-error non-standard attribute for folder pickers
      webkitdirectory={directory === true ? "" : undefined}
      onChange={(event) => {
        const files = event.target.files
        if (files !== null && files.length > 0) {
          onChoose(files)
        }
        event.target.value = ""
      }}
    />
  ),
)
HiddenFileInput.displayName = "HiddenFileInput"
