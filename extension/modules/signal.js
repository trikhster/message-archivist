// Signal: not yet. It has no plain export: its phone backups are encrypted
// with a passphrase, and Signal Desktop's database with a key in the
// computer's keychain, which only a native helper could reach
// (notes/Desktop app.md).
GMLib.addModule({
  id: 'signal', label: 'Signal', short: 'SG', folder: 'Signal', color: '#3a76f0', ids: 'phone', book: true,
  later: 'Signal has no plain export: its backups are encrypted. Signal Desktop’s messages need the same planned helper app as iMessage.',
});
