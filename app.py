from flask import Flask, render_template, request, jsonify, redirect, url_for, session
from werkzeug.security import generate_password_hash, check_password_hash
from functools import wraps
from deepface import DeepFace
import sqlite3
import base64
import cv2
import numpy as np
import os
from datetime import datetime

app = Flask(__name__)
app.secret_key = "ai_smart_assistant_local_key"

DATABASE = os.path.join(app.root_path, "database.db")


# DATABASE CONNECTION
def get_db():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection


# CREATE DATABASE TABLES
def init_db():
    connection = get_db()

    connection.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            email TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
        )
    """)

    connection.execute("""
        CREATE TABLE IF NOT EXISTS emotion_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            emotion TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    """)

    connection.commit()
    connection.close()


# LOGIN REQUIRED
def login_required(function):
    @wraps(function)
    def wrapper(*args, **kwargs):
        if "user_id" not in session:
            return redirect(url_for("login"))
        return function(*args, **kwargs)

    return wrapper


# HOME PAGE
@app.route("/")
def index():
    if "user_id" in session:
        return render_template("index.html")

    return redirect(url_for("login"))


# REGISTRATION
@app.route("/register", methods=["GET", "POST"])
def register():
    if request.method == "POST":
        name = request.form.get("name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        if not name or not email or not password:
            return "Please fill in all fields."

        if len(password) < 6:
            return "Password must contain at least 6 characters."

        connection = get_db()

        try:
            password_hash = generate_password_hash(password)

            connection.execute(
                "INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)",
                (name, email, password_hash)
            )

            connection.commit()

            return redirect(url_for("login"))

        except sqlite3.IntegrityError:
            return "This email is already registered. Please log in."

        finally:
            connection.close()

    return render_template("register.html")


# LOGIN
@app.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")

        connection = get_db()

        user = connection.execute(
            "SELECT * FROM users WHERE email = ?",
            (email,)
        ).fetchone()

        connection.close()

        if user and check_password_hash(user["password_hash"], password):
            session["user_id"] = user["id"]
            session["user_name"] = user["name"]

            return redirect(url_for("dashboard"))

        return "Incorrect email or password. Please try again."

    return render_template("login.html")


# DASHBOARD
@app.route("/dashboard")
@login_required
def dashboard():
    connection = get_db()

    history = connection.execute(
        """
        SELECT emotion, created_at
        FROM emotion_history
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT 20
        """,
        (session["user_id"],)
    ).fetchall()

    connection.close()

    return render_template(
        "dashboard.html",
        user_name=session.get("user_name", "User"),
        history=history
    )


# LOGOUT
@app.route("/logout")
def logout():
    session.clear()
    return redirect(url_for("login"))


# EMOTION DETECTION
@app.route("/analyze", methods=["POST"])
@login_required
def analyze_emotion():
    try:
        data = request.get_json(silent=True)

        if not data or "image" not in data:
            return jsonify({
                "success": False,
                "error": "No image received."
            }), 400

        image_data = data["image"]

        if "," in image_data:
            image_data = image_data.split(",", 1)[1]

        image_bytes = base64.b64decode(image_data)
        image_array = np.frombuffer(image_bytes, dtype=np.uint8)

        frame = cv2.imdecode(image_array, cv2.IMREAD_COLOR)

        if frame is None:
            return jsonify({
                "success": False,
                "error": "Unable to read image."
            }), 400

        result = DeepFace.analyze(
            img_path=frame,
            actions=["emotion"],
            enforce_detection=True,
            detector_backend="opencv"
        )

        if isinstance(result, list):
            result = result[0]

        emotion = str(
            result.get("dominant_emotion", "unknown")
        ).lower()

        scores = {
            str(key).lower(): float(value)
            for key, value in result.get("emotion", {}).items()
        }

        connection = get_db()

        connection.execute(
            """
            INSERT INTO emotion_history (user_id, emotion, created_at)
            VALUES (?, ?, ?)
            """,
            (
                session["user_id"],
                emotion,
                datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            )
        )

        connection.commit()
        connection.close()

        return jsonify({
            "success": True,
            "emotion": emotion,
            "scores": scores
        })

    except Exception as error:
        print("Emotion Detection Error:", str(error))

        return jsonify({
            "success": False,
            "error": "Emotion detection failed. Please try again."
        }), 500


# START APPLICATION
init_db()

if __name__ == "__main__":
    app.run(debug=True, host="127.0.0.1", port=5000)