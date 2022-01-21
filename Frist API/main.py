import pandas as pd
from flask import Flask, jsonify

app = Flask(__name__)

#construindo

@app.route('/')
def homepage():
  return 'A API está funcionando corretamente!'


@app.route('/pegarVendas')
def pegarVendas():
  tabela = pd.read_csv('advertising.csv')

  total_vendas = tabela["Vendas"].sum()
  resposta = {'total_vendas' : total_vendas}

  return jsonify(resposta)

#excutando  

app.run(host = '0.0.0.0')


#Como consumir a API:

#import requests

#link = 'https://minhaapi.felipechantal.repl.co/pegarVendas'

#requisicao = requests.get(link)


#print(requisicao)
#print(requisicao.json())

#dicionario = requisicao.json()

