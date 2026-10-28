// iMessage: not yet. The Messages database on a Mac (~/Library/Messages/
// chat.db, readable only with Full Disk Access) is out of a browser's reach;
// a small native helper beside the app will read it (notes/Desktop app.md).
// Its texts, with an iPhone's SMS, are a source of their own, apart from
// Google Messages' (notes/Sources.md).
GMLib.addModule({
  id: 'imessage', label: 'iMessage', short: 'iM', folder: 'iMessage', color: '#34c759', ids: 'phone or email', book: true,
  later: 'iMessage keeps its messages in a database on your Mac that a browser can’t read. A small helper app for it is planned.',
});
