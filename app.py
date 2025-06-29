from flask import Flask, jsonify, render_template
import json
import random

app = Flask(__name__,
            static_folder='static',
            template_folder='templates')

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/quiz')
def get_quiz():
    """クイズデータを動的に生成して、JSON形式で返す"""
    with open('quizzes.json', 'r', encoding='utf-8') as f:
        # JSONを読み込むと、all_prefecturesは都道府県名のリストになる
        all_prefectures = json.load(f)

    # 1. リストから正解をランダムに1つ選ぶ
    correct_answer = random.choice(all_prefectures)

    # 2. 正解以外の都道府県のリストを作る
    wrong_prefectures = [p for p in all_prefectures if p != correct_answer]

    # 3. 正解以外のリストから、不正解の選択肢を3つランダムに選ぶ
    wrong_choices = random.sample(wrong_prefectures, 3)

    # 4. 正解と不正解の選択肢を結合して、シャッフルする
    choices = wrong_choices + [correct_answer]
    random.shuffle(choices)

    response_data = {
        'correctAnswer': correct_answer,
        'choices': choices
    }

    return jsonify(response_data)

if __name__ == '__main__':
    app.run(debug=True, port=5001)