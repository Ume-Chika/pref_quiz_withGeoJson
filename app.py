from flask import Flask, jsonify, render_template
import json
import random

app = Flask(__name__,
            static_folder='static',
            template_folder='templates')

# GeoJSONから都道府県名を読み込み、アプリケーション起動時に一度だけ実行
def load_prefectures_from_geojson():
    try:
        with open('static/data/low_prefectures.geojson', 'r', encoding='utf-8') as f:
            data = json.load(f)
        # 'features'リストから各featureの'properties'にある'name'を抽出
        prefectures = [feature['properties']['name'] for feature in data['features']]
        return prefectures
    except FileNotFoundError:
        print("エラー: 'low_prefectures.geojson' が見つかりません。")
        return []
    except json.JSONDecodeError:
        print("エラー: 'low_prefectures.geojson' のJSON形式が正しくありません。")
        return []
    except KeyError:
        print("エラー: GeoJSONの形式が予期したものと異なります。（'features'または'properties'/'name'キーが見つかりません）")
        return []

ALL_PREFECTURES = load_prefectures_from_geojson()
# 都道府県リストが正常に読み込まれたか確認
if not ALL_PREFECTURES:
    print("警告: 都道府県リストが空です。クイズは正常に動作しない可能性があります。")

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/api/quiz')
def get_quiz():
    """クイズデータを動的に生成して、JSON形式で返す"""
    # 1. 全都道府県リストから、ランダムに4つの選択肢を重複なく選ぶ
    choices = random.sample(ALL_PREFECTURES, 4)

    # 2. 4つの選択肢の中から、ランダムに1つを正解として選ぶ
    correct_answer = random.choice(choices)

    # `choices`リストはrandom.sampleによって既にランダムな順序になっているため、
    # 再度シャッフルする必要はありません。

    response_data = {
        'correctAnswer': correct_answer,
        'choices': choices
    }

    return jsonify(response_data)

if __name__ == '__main__':
    app.run(debug=True, port=5001)