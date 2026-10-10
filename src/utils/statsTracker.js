const { getStatsDB } = require("./statsDB");
const crypto = require("crypto");

/**
 * Generate a unique session ID
 */
function generateSessionId() {
    return crypto.randomBytes(16).toString("hex");
}

/**
 * Ensure a user exists in the database
 */
function ensureUser(userId) {
    const db = getStatsDB();
    const stmt = db.prepare(`
        INSERT OR IGNORE INTO user_stats (user_id, total_listening_ms, tracks_played)
        VALUES (?, 0, 0)
    `);
    stmt.run(userId);
}

/**
 * Start a new listening session
 */
function startSession(guildId, userId, track) {
    const db = getStatsDB();
    ensureUser(userId);

    const sessionId = generateSessionId();
    const now = Date.now();

    const stmt = db.prepare(`
        INSERT INTO active_sessions
        (session_id, guild_id, user_id, track_id, track_title, track_artist, track_uri, started_at, last_position_ms, is_paused)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
    `);

    stmt.run(
        sessionId,
        guildId,
        userId,
        track.info.uri || track.info.identifier || "unknown",
        track.info.title || "Unknown",
        track.info.author || null,
        track.info.uri || null,
        now
    );

    return sessionId;
}

/**
 * Update session progress (called periodically or on track end)
 * Also commits the progress to statistics incrementally
 */
function updateSessionProgress(sessionId, positionMs, isPaused = false) {
    const db = getStatsDB();

    // Get current session state
    const session = db.prepare(`
        SELECT guild_id, user_id, track_id, track_title, track_artist, track_uri,
               last_position_ms, started_at
        FROM active_sessions
        WHERE session_id = ?
    `).get(sessionId);

    if (!session) return;

    // Calculate time difference since last update
    const timeDiffMs = positionMs - session.last_position_ms;

    // Only update if time has progressed and not paused
    if (timeDiffMs > 0 && !isPaused) {
        try {
            // Ensure user exists in database BEFORE any operations
            ensureUser(session.user_id);
            const now = Date.now();

            // Also ensure friends exist before updating shared listening
            const participants = db.prepare(`
                SELECT user_id FROM session_participants
                WHERE session_id = ? AND user_id != ?
            `).all(sessionId, session.user_id);
            
            for (const participant of participants) {
                ensureUser(participant.user_id);
            }

            // Update user total listening time
            const userStmt = db.prepare(`
                UPDATE user_stats
                SET total_listening_ms = total_listening_ms + ?,
                    updated_at = ?
                WHERE user_id = ?
            `);
            userStmt.run(timeDiffMs, now, session.user_id);

            // Update server listening time
            const serverStmt = db.prepare(`
                INSERT INTO server_stats (user_id, guild_id, listening_ms)
                VALUES (?, ?, ?)
                ON CONFLICT(user_id, guild_id)
                DO UPDATE SET listening_ms = listening_ms + ?
            `);
            serverStmt.run(session.user_id, session.guild_id, timeDiffMs, timeDiffMs);

            // Update track statistics
            const trackStmt = db.prepare(`
                INSERT INTO track_stats (user_id, track_id, track_title, track_artist, track_uri, listening_ms, play_count)
                VALUES (?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(user_id, track_id)
                DO UPDATE SET
                    listening_ms = listening_ms + ?,
                    track_title = ?,
                    track_artist = ?,
                    track_uri = ?
            `);
            trackStmt.run(
                session.user_id,
                session.track_id,
                session.track_title,
                session.track_artist,
                session.track_uri,
                timeDiffMs,
                timeDiffMs,
                session.track_title,
                session.track_artist,
                session.track_uri
            );

            // Update shared listening time (using actual elapsed time)
            updateSharedListening(sessionId, session.guild_id, session.user_id, timeDiffMs);
        } catch (error) {
            console.error("[euphire] Failed to update session progress:", error.message);
        }
    }

    // Update session position
    const stmt = db.prepare(`
        UPDATE active_sessions
        SET last_position_ms = ?, is_paused = ?
        WHERE session_id = ?
    `);

    stmt.run(positionMs, isPaused ? 1 : 0, sessionId);
}

/**
 * End a session and commit the listening time to statistics
 */
function endSession(sessionId) {
    const db = getStatsDB();

    try {
        // Get session details
        const sessionStmt = db.prepare(`
            SELECT guild_id, user_id, track_id, track_title, track_artist, track_uri,
                   started_at, last_position_ms
            FROM active_sessions
            WHERE session_id = ?
        `);

        const session = sessionStmt.get(sessionId);
        if (!session) return;

        const now = Date.now();
        const durationMs = session.last_position_ms;

        // Only increment track play count - time is already added incrementally via updateSessionProgress
        if (durationMs > 0) {
            ensureUser(session.user_id);
            
            // Update user tracks played count only (time already added)
            const userStmt = db.prepare(`
                UPDATE user_stats
                SET tracks_played = tracks_played + 1,
                    updated_at = ?
                WHERE user_id = ?
            `);
            userStmt.run(now, session.user_id);

            // Update track play count only (time already added)
            const trackStmt = db.prepare(`
                INSERT INTO track_stats (user_id, track_id, track_title, track_artist, track_uri, listening_ms, play_count)
                VALUES (?, ?, ?, ?, ?, 0, 1)
                ON CONFLICT(user_id, track_id)
                DO UPDATE SET
                    play_count = play_count + 1,
                    track_title = ?,
                    track_artist = ?,
                    track_uri = ?
            `);
            trackStmt.run(
                session.user_id,
                session.track_id,
                session.track_title,
                session.track_artist,
                session.track_uri,
                session.track_title,
                session.track_artist,
                session.track_uri
            );
        }

        // Delete session and participants
        db.prepare("DELETE FROM session_participants WHERE session_id = ?").run(sessionId);
        db.prepare("DELETE FROM active_sessions WHERE session_id = ?").run(sessionId);
    } catch (error) {
        console.error("[euphire] Failed to end stats session:", error.message);
    }
}

/**
 * Add a participant to an active session
 */
function addSessionParticipant(sessionId, userId) {
    const db = getStatsDB();
    const now = Date.now();

    // Use INSERT OR REPLACE to ensure joined_at is updated if already exists
    const stmt = db.prepare(`
        INSERT INTO session_participants (session_id, user_id, joined_at)
        VALUES (?, ?, ?)
        ON CONFLICT(session_id, user_id)
        DO UPDATE SET joined_at = ?
    `);
    stmt.run(sessionId, userId, now, now);
}

/**
 * Remove a participant from an active session
 */
function removeSessionParticipant(sessionId, userId) {
    const db = getStatsDB();

    try {
        // When removing a participant, we don't need to add extra time
        // because the time has already been added incrementally via updateSharedListening
        // during the session updates. Just remove them from the session.
        db.prepare("DELETE FROM session_participants WHERE session_id = ? AND user_id = ?").run(sessionId, userId);
    } catch (error) {
        console.error("[euphire] Failed to remove session participant:", error.message);
    }
}

/**
 * Update shared listening time for all current participants
 */
function updateSharedListening(sessionId, guildId, ownerId, durationMs) {
    const db = getStatsDB();

    // Get all participants (excluding the owner) with their join times
    const participants = db.prepare(`
        SELECT user_id, joined_at FROM session_participants
        WHERE session_id = ? AND user_id != ?
    `).all(sessionId, ownerId);

    const updateShared = db.prepare(`
        INSERT INTO shared_listening (user_id, friend_id, guild_id, shared_ms)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id, friend_id, guild_id)
        DO UPDATE SET shared_ms = shared_ms + ?
    `);

    const updateJoinTime = db.prepare(`
        UPDATE session_participants
        SET joined_at = ?
        WHERE session_id = ? AND user_id = ?
    `);

    const now = Date.now();

    for (const participant of participants) {
        // Ensure participant exists in database
        ensureUser(participant.user_id);
        
        // Use exact track duration for shared listening - this is the actual playback time
        const sharedDuration = durationMs;
        
        if (sharedDuration > 0) {
            // Update shared time for owner -> participant
            updateShared.run(ownerId, participant.user_id, guildId, sharedDuration, sharedDuration);
            // Update shared time for participant -> owner
            updateShared.run(participant.user_id, ownerId, guildId, sharedDuration, sharedDuration);
        }
        
        // Update their join time to now for the next update
        updateJoinTime.run(now, sessionId, participant.user_id);
    }
}

/**
 * Get user statistics for profile
 */
function getUserStats(userId) {
    const db = getStatsDB();
    ensureUser(userId);

    const user = db.prepare(`
        SELECT total_listening_ms, tracks_played
        FROM user_stats
        WHERE user_id = ?
    `).get(userId);

    return user || { total_listening_ms: 0, tracks_played: 0 };
}

/**
 * Get top servers for a user
 */
function getTopServers(userId, limit = 3) {
    const db = getStatsDB();

    const stmt = db.prepare(`
        SELECT guild_id, listening_ms
        FROM server_stats
        WHERE user_id = ? AND listening_ms > 0
        ORDER BY listening_ms DESC
        LIMIT ?
    `);

    return stmt.all(userId, limit);
}

/**
 * Get top friends for a user
 */
function getTopFriends(userId, limit = 3) {
    const db = getStatsDB();

    const stmt = db.prepare(`
        SELECT friend_id, SUM(shared_ms) as total_shared_ms
        FROM shared_listening
        WHERE user_id = ? AND shared_ms > 0
        GROUP BY friend_id
        ORDER BY total_shared_ms DESC
        LIMIT ?
    `);

    return stmt.all(userId, limit);
}

/**
 * Get top tracks for a user
 */
function getTopTracks(userId, limit = 3) {
    const db = getStatsDB();

    const stmt = db.prepare(`
        SELECT track_title, track_artist, listening_ms, play_count
        FROM track_stats
        WHERE user_id = ? AND listening_ms > 0
        ORDER BY listening_ms DESC
        LIMIT ?
    `);

    return stmt.all(userId, limit);
}

/**
 * Clean up orphaned sessions (called on bot startup)
 */
function cleanupOrphanedSessions() {
    const db = getStatsDB();
    const now = Date.now();
    const staleThreshold = 24 * 60 * 60 * 1000; // 24 hours

    // Find sessions older than 24 hours
    const staleSessions = db.prepare(`
        SELECT session_id FROM active_sessions
        WHERE started_at < ?
    `).all(now - staleThreshold);

    for (const session of staleSessions) {
        try {
            endSession(session.session_id);
        } catch (err) {
            console.error("[euphire] Failed to cleanup session:", err.message);
        }
    }

    console.log(`[euphire] Cleaned up ${staleSessions.length} orphaned sessions.`);
}

module.exports = {
    generateSessionId,
    startSession,
    updateSessionProgress,
    endSession,
    addSessionParticipant,
    removeSessionParticipant,
    getUserStats,
    getTopServers,
    getTopFriends,
    getTopTracks,
    cleanupOrphanedSessions,
};
