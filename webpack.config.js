const path = require('path')
const HtmlWebpackPlugin = require('html-webpack-plugin')
const MiniCssExtractPlugin = require('mini-css-extract-plugin')

const isProduction = process.env.NODE_ENV == 'production'

const stylesHandler = isProduction
    ? MiniCssExtractPlugin.loader
    : 'style-loader'

const config = {
    entry: {
        popup: './popup.js',
    },
    output: {
        filename: '[name].js',
        path: path.resolve(__dirname, 'dist'),
        clean: true,
    },
    devtool: false, // Disable source maps for Chrome extension
    plugins: [
        new HtmlWebpackPlugin({
            filename: 'popup.html',
            template: 'popup.html',
            chunks: ['popup'],
            inject: 'body',
        }),
    ],
    module: {
        rules: [
            {
                test: /\.s[ac]ss$/i,
                use: [
                    stylesHandler,
                    'css-loader',
                    'postcss-loader',
                    'sass-loader',
                ],
            },
            {
                test: /\.css$/i,
                use: [stylesHandler, 'css-loader', 'postcss-loader'],
            },
            {
                test: /\.(eot|svg|ttf|woff|woff2|png|jpg|gif)$/i,
                type: 'asset',
            },
        ],
    },
    optimization: {
        splitChunks: false, // Completely disable code splitting
        runtimeChunk: false, // Disable runtime chunk
        minimize: isProduction,
    },
}

module.exports = () => {
    if (isProduction) {
        config.mode = 'production'
        config.plugins.push(
            new MiniCssExtractPlugin({
                filename: '[name].css',
            })
        )
    } else {
        config.mode = 'development'
    }
    return config
}
