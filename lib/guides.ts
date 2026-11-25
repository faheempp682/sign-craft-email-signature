export type Guide = {
  id: string;
  name: string;
  /** Which export button to use first. */
  method: "Copy as rich text" | "Download .htm";
  steps: string[];
  note?: string;
};

/**
 * Install steps per email client (PROJECT.md section 12). Menu names shift between versions, so the page tells
 * people to look for the closest match instead of promising exact labels.
 */
export const GUIDES: Guide[] = [
  {
    id: "gmail",
    name: "Gmail",
    method: "Copy as rich text",
    steps: [
      "In SignCraft, click Copy as rich text.",
      "In Gmail, click the gear icon, then See all settings.",
      "On the General tab, scroll to Signature and click Create new. Name it.",
      "Click into the signature box and paste (Ctrl+V or Cmd+V).",
      "Under Signature defaults, choose it for New emails and for Reply/forward.",
      "Scroll to the bottom and click Save Changes.",
    ],
    note: "Images show because they are hosted online. Gmail may add its own link colour to phone numbers and addresses.",
  },
  {
    id: "outlook-web",
    name: "Outlook on the web / new Outlook",
    method: "Copy as rich text",
    steps: [
      "In SignCraft, click Copy as rich text.",
      "In Outlook, open Settings (gear icon), then Accounts, then Signatures. On Outlook.com or Microsoft 365 web this can be View all Outlook settings, Compose and reply, Email signature.",
      "Click New signature and name it.",
      "Paste into the editor box.",
      "Choose it as the default for new messages and replies, then click Save.",
    ],
  },
  {
    id: "outlook-desktop",
    name: "Outlook desktop (Windows)",
    method: "Copy as rich text",
    steps: [
      "In SignCraft, click Copy as rich text.",
      "In Outlook, open File, Options, Mail, then Signatures.",
      "Click New, name it, and paste into the edit box at the bottom.",
      "Pick it as the default for New messages and Replies/forwards, then click OK.",
    ],
    note: "Alternative: click Download .htm, save the file into %APPDATA%\\Microsoft\\Signatures, and restart Outlook. If it does not appear in the list, use the paste method above. Outlook desktop shows only the first frame of an animated GIF.",
  },
  {
    id: "apple-mail",
    name: "Apple Mail (Mac)",
    method: "Copy as rich text",
    steps: [
      "In SignCraft, click Copy as rich text.",
      "In Mail, open Mail menu, Settings, then Signatures.",
      "Select your account on the left, click the + button, and name the signature.",
      "Untick Always match my default message font, so the fonts and colours are kept.",
      "Paste into the preview box on the right, then close the window to save.",
    ],
    note: "If Mail changes the layout after pasting, close and reopen Settings once; Mail finishes processing the HTML on save.",
  },
  {
    id: "thunderbird",
    name: "Thunderbird",
    method: "Download .htm",
    steps: [
      "In SignCraft, click Download .htm and save the file somewhere permanent.",
      "In Thunderbird, open Account Settings and select your account.",
      "Tick Attach the signature from a file instead (text, HTML, or image).",
      "Click Choose and select the downloaded .htm file, then click OK.",
    ],
    note: "Thunderbird reads the file each time you send, so re-download and replace it whenever the design changes.",
  },
  {
    id: "mobile",
    name: "Phone and tablet apps",
    method: "Copy as rich text",
    steps: [
      "Set up the full signature on your computer first. Most phone apps cannot edit a designed signature.",
      "iPhone / iPad Mail: Settings, then Mail, then Signature. Pasting rich text often works, but images may not appear. Send yourself a test.",
      "Gmail and Outlook phone apps use their own plain-text signature, separate from the one you set on the web or desktop.",
    ],
    note: "Messages you send from a computer carry the full design. Messages sent from a phone app usually carry only the plain-text signature.",
  },
];
