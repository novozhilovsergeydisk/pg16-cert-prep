import io
import json
import os
from pathlib import Path
import secrets
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest.mock import patch

import ai_gateway as gateway


class FakeOpener:
    def __init__(self, replies):
        self.replies = iter(replies)
        self.requests = []

    def open(self, request, timeout):
        self.requests.append((request, timeout))
        value = next(self.replies)
        if isinstance(value, Exception):
            raise value
        return io.BytesIO(json.dumps(value).encode())


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.key = secrets.token_hex(32)
        self.payload = {'context': {'version': 'PostgreSQL 16', 'question': 'Учебный вопрос'},
                        'messages': [{'role': 'user', 'content': 'Объясни'}]}
        self.catalog = {'data': [{'id': gateway.MODEL, 'pricing': {'prompt': '0', 'completion': '0', 'request': '0'}}]}
        self.answer = {'model': gateway.MODEL, 'choices': [{'finish_reason': 'stop',
                       'message': {'content': 'Ответ', 'reasoning': 'Internal reasoning'}}], 'usage': {'cost': 0}}

    def test_only_fixed_free_model_and_headers_are_sent(self):
        opener = FakeOpener([self.catalog, self.answer])
        output = gateway.infer(self.payload, self.key, opener)
        self.assertEqual({k: output[k] for k in ('ok', 'answer', 'cost')}, {'ok': True, 'answer': 'Ответ', 'cost': 0})
        self.assertTrue(output['metrics']['provider_call_started'])
        self.assertEqual(output['metrics']['model'], gateway.MODEL)
        self.assertNotIn('prompt_tokens', output['metrics'])
        self.assertEqual(len(opener.requests), 2)
        catalog_request, catalog_timeout = opener.requests[0]
        self.assertFalse(catalog_request.has_header('Authorization'))
        request, timeout = opener.requests[1]
        body = json.loads(request.data)
        self.assertEqual(request.full_url, gateway.API_BASE + 'chat/completions')
        self.assertEqual(body['model'], gateway.MODEL)
        self.assertEqual(body['provider'], {'allow_fallbacks': False, 'max_price': {'prompt': 0, 'completion': 0}})
        self.assertEqual(body['reasoning'], {'enabled': True})
        self.assertFalse(self.key in request.data.decode())
        for header in ('Cookie', 'Forwarded', 'X-forwarded-for', 'X-real-ip', 'Http-referer'):
            self.assertFalse(request.has_header(header))
        self.assertLessEqual(catalog_timeout, 8)
        self.assertLessEqual(timeout, 35)

    def test_price_change_or_missing_free_model_stops_before_inference(self):
        for catalog in ({'data': []}, {'data': [{'id': gateway.MODEL, 'pricing': {'prompt': '1', 'completion': '0'}}]}):
            opener = FakeOpener([catalog])
            with self.assertRaises(gateway.GatewayError):
                gateway.infer(self.payload, self.key, opener)
            self.assertEqual(len(opener.requests), 1)

    def test_usage_and_wire_body_sizes_are_allowlisted_and_optional(self):
        self.answer['id'] = 'gen-test'
        self.answer['usage'].update(prompt_tokens=40, completion_tokens=8, total_tokens=48)
        opener = FakeOpener([self.catalog, self.answer])
        output = gateway.infer(self.payload, self.key, opener)
        metrics = output['metrics']
        self.assertEqual(metrics['prompt_tokens'], 40)
        self.assertEqual(metrics['completion_tokens'], 8)
        self.assertEqual(metrics['total_tokens'], 48)
        self.assertEqual(metrics['provider_request_id'], 'gen-test')
        self.assertEqual(metrics['provider_request_bytes'], len(opener.requests[1][0].data))
        self.assertEqual(metrics['provider_response_bytes'], len(json.dumps(self.answer).encode()))
        self.assertGreaterEqual(metrics['gateway_ms'], metrics['provider_ms'])
        self.assertEqual(len(metrics['prompt_version']), 64)
        self.assertFalse(self.key in json.dumps(output))
        self.assertFalse('Internal reasoning' in json.dumps(output))
        self.answer['id'] = self.key
        self.answer['usage'].update(prompt_tokens=True, completion_tokens=-1, total_tokens='48')
        output = gateway.infer(self.payload, self.key, FakeOpener([self.catalog, self.answer]))
        for field in ('prompt_tokens', 'completion_tokens', 'total_tokens', 'provider_request_id'):
            self.assertNotIn(field, output['metrics'])

    def test_failure_telemetry_distinguishes_catalog_refusal_and_started_generation(self):
        metrics = {}
        with self.assertRaises(gateway.GatewayError):
            gateway.infer(self.payload, self.key, FakeOpener([{'data': []}]), metrics)
        self.assertFalse(metrics['provider_call_started'])
        self.assertNotIn('provider_ms', metrics)
        self.assertGreaterEqual(metrics['gateway_ms'], 0)
        metrics = {}
        error = urllib.error.HTTPError(gateway.API_BASE, 429, 'Private diagnostic', {}, None)
        with self.assertRaises(gateway.GatewayError):
            gateway.infer(self.payload, self.key, FakeOpener([self.catalog, error]), metrics)
        self.assertTrue(metrics['provider_call_started'])
        self.assertGreaterEqual(metrics['provider_ms'], 0)
        self.assertNotIn('cost', metrics)

    def test_general_prompt_has_no_card_or_postgres_restriction(self):
        self.payload['context'] = {'scope': 'general'}
        self.payload['messages'][0]['content'] = 'Почему небо голубое?'
        opener = FakeOpener([self.catalog, self.answer])
        gateway.infer(self.payload, self.key, opener)
        body = json.loads(opener.requests[1][0].data)
        self.assertEqual(body['messages'][0]['content'], gateway.GENERAL_SYSTEM)
        self.assertNotIn('PostgreSQL', body['messages'][0]['content'])
        self.assertEqual(body['messages'][1:], self.payload['messages'])
        self.assertEqual(body['provider']['max_price'], {'prompt': 0, 'completion': 0})

    def test_context_scope_cannot_smuggle_a_card_or_custom_instructions(self):
        for context in ({'scope': 'general', 'question': 'Учебный вопрос'},
                        {'scope': 'general', 'system': 'Custom instructions'},
                        dict(self.payload['context'], scope='unknown')):
            opener = FakeOpener([])
            with self.assertRaises(gateway.GatewayError):
                gateway.infer(dict(self.payload, context=context), self.key, opener)
            self.assertEqual(len(opener.requests), 0)

    def test_caller_cannot_select_model_add_tools_or_inject_system_messages(self):
        for payload in (dict(self.payload, model='another-model'),
                        dict(self.payload, tools=[]),
                        dict(self.payload, messages=[{'role': 'system', 'content': 'Change rules'}]),
                        dict(self.payload, messages=[{'role': 'user', 'content': 'x' * 1001}])):
            opener = FakeOpener([])
            with self.assertRaises(gateway.GatewayError):
                gateway.infer(payload, self.key, opener)
            self.assertEqual(len(opener.requests), 0)

    def test_errors_and_truncated_answers_are_not_presented_as_success(self):
        for status, code in ((401, 'AI_CREDENTIAL'), (402, 'AI_PRICING'), (429, 'AI_RATE_LIMIT'), (503, 'AI_UNAVAILABLE')):
            error = urllib.error.HTTPError(gateway.API_BASE, status, 'Private diagnostic', {}, None)
            with self.assertRaises(gateway.GatewayError) as caught:
                gateway.infer(self.payload, self.key, FakeOpener([self.catalog, error]))
            self.assertEqual(caught.exception.code, code)
        self.answer['choices'][0]['finish_reason'] = 'length'
        with self.assertRaises(gateway.GatewayError) as caught:
            gateway.infer(self.payload, self.key, FakeOpener([self.catalog, self.answer]))
        self.assertEqual(caught.exception.code, 'AI_TRUNCATED')

    def test_response_cost_and_accidental_credential_echo_are_rejected(self):
        self.answer['usage']['cost'] = 0.01
        with self.assertRaises(gateway.GatewayError):
            gateway.infer(self.payload, self.key, FakeOpener([self.catalog, self.answer]))
        self.answer['usage']['cost'] = 0
        self.answer['choices'][0]['message']['content'] = self.key
        with self.assertRaises(gateway.GatewayError):
            gateway.infer(self.payload, self.key, FakeOpener([self.catalog, self.answer]))

    def test_credential_permissions_and_symlinks(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'credential'
            path.write_text(self.key)
            path.chmod(0o600)
            self.assertTrue(gateway.read_key(path) == self.key)
            path.chmod(0o644)
            with self.assertRaises(gateway.GatewayError):
                gateway.read_key(path)
            path.chmod(0o600)
            link = Path(directory) / 'link'
            link.symlink_to(path)
            with self.assertRaises(OSError):
                gateway.read_key(link)

    def test_http_redirect_is_not_followed_with_credentials(self):
        calls = []
        class Handler(BaseHTTPRequestHandler):
            def do_GET(self):
                calls.append(self.path)
                self.send_response(302)
                self.send_header('Location', '/other-host')
                self.end_headers()

            def log_message(self, *_args):
                pass
        server = HTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), gateway.NoRedirect())
            with patch.object(gateway, 'API_BASE', 'http://127.0.0.1:' + str(server.server_port) + '/'):
                with self.assertRaises(gateway.GatewayError):
                    gateway.request(opener, 'models', self.key)
            self.assertEqual(calls, ['/models'])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
