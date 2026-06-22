const isDev = process.env.NODE_ENV === 'development';

// eslint-disable-next-line no-unused-vars
module.exports = function errorHandler(err, req, res, next) {
  const status = err.statusCode || err.status || err.response?.status || 500;

  // Never leak internal details in production
  res.status(status).json({
    error: status < 500 ? err.message : 'Internal server error',
    ...(isDev && { detail: err.message, stack: err.stack }),
  });
};
