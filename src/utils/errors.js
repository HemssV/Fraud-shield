class EntityNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = 'EntityNotFoundError';
    this.code = 'ENTITY_NOT_FOUND';
    this.statusCode = 404;
  }
}

module.exports = {
  EntityNotFoundError,
};
