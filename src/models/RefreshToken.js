const mongoose = require('mongoose');

const refreshTokenSchema = new mongoose.Schema({
  token: {
    type: String,
    required: true,
    unique: true
  },
  
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  
  expiresAt: {
    type: Date,
    required: true,
    index: { expireAfterSeconds: 0 } // MongoDB TTL index - automatically delete expired tokens
  },
  
  isRevoked: {
    type: Boolean,
    default: false
  },
  
  userAgent: {
    type: String
  },
  
  ipAddress: {
    type: String
  }
}, {
  timestamps: true
});

// Static method to create refresh token
refreshTokenSchema.statics.createToken = async function(userId, token, expiresIn, userAgent, ipAddress) {
  const expiresAt = new Date(Date.now() + expiresIn);
  
  return this.create({
    token,
    user: userId,
    expiresAt,
    userAgent,
    ipAddress
  });
};

// Static method to find valid token
refreshTokenSchema.statics.findValidToken = async function(token) {
  return this.findOne({
    token,
    expiresAt: { $gt: new Date() },
    isRevoked: false
  }).populate('user');
};

// Static method to revoke token
refreshTokenSchema.statics.revokeToken = async function(token) {
  return this.updateOne(
    { token },
    { $set: { isRevoked: true } }
  );
};

// Static method to revoke all user tokens
refreshTokenSchema.statics.revokeAllUserTokens = async function(userId) {
  return this.updateMany(
    { user: userId },
    { $set: { isRevoked: true } }
  );
};

// Static method to cleanup expired tokens (optional - TTL index handles this automatically)
refreshTokenSchema.statics.cleanupExpired = async function() {
  return this.deleteMany({
    expiresAt: { $lt: new Date() }
  });
};

const RefreshToken = mongoose.model('RefreshToken', refreshTokenSchema);

module.exports = RefreshToken;
