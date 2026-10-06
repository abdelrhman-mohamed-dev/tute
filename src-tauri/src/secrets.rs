// Secrets live in the Windows Credential Manager, never on disk and never in
// the page. Two kinds: an AI provider's API key, and a connected service's
// sign-in (Linear's tokens, as JSON). The page can store, replace or remove a
// key and ask whether one is there; it can never read one back.

use keyring::Entry;

/// Everything is filed under the app's identifier.
const SERVICE: &str = "dev.abdelrhman.tute";

/// Where a secret goes.
#[derive(Clone, Copy)]
pub enum Slot<'a> {
    /// An AI provider's key, by the provider's id.
    Key(&'a str),
    /// A connected service's sign-in, by the service's name.
    Login(&'a str),
}

impl Slot<'_> {
    /// Its name in the Credential Manager. These names are what's stored on
    /// people's machines: changing them would lose every saved key.
    fn entry(self) -> Result<Entry, String> {
        let (prefix, id) = match self {
            Slot::Key(id) => ("provider", id),
            Slot::Login(id) => ("service", id),
        };
        // Ids come from the page: only short, plain ones become entry names.
        if !plain(id) {
            return Err(format!("not a valid {prefix} id: {id:?}"));
        }
        Entry::new(SERVICE, &format!("{prefix}:{id}")).map_err(|e| e.to_string())
    }
}

fn plain(id: &str) -> bool {
    (1..=40).contains(&id.len()) && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

/// The secret, if one is stored. Only Rust ever sees it.
pub fn read(slot: Slot) -> Option<String> {
    slot.entry().ok()?.get_password().ok().filter(|s| !s.is_empty())
}

/// Stores a secret; an empty one removes it instead.
pub fn write(slot: Slot, value: &str) -> Result<(), String> {
    let value = value.trim();
    if value.is_empty() {
        return forget(slot);
    }
    slot.entry()?.set_password(value).map_err(|e| e.to_string())
}

/// Removes a secret. Already gone is fine.
pub fn forget(slot: Slot) -> Result<(), String> {
    match slot.entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn holds(slot: Slot) -> bool {
    read(slot).is_some()
}

#[cfg(test)]
mod tests {
    use super::plain;

    #[test]
    fn only_plain_ids_become_names() {
        assert!(plain("p-lq3k9x"));
        assert!(plain("linear"));
        assert!(!plain(""));
        assert!(!plain("../other"));
        assert!(!plain("a b"));
        assert!(!plain(&"x".repeat(41)));
    }
}
