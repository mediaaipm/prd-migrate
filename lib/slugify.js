// Project slug derivation. Lives on its own so the client can compute the slug of a
// project it is optimistically creating, without pulling in the redis store.
// Must stay byte-for-byte in agreement with the server: the slug is the project's
// primary key and is immutable after creation.
function slugify(name) {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

module.exports = { slugify };
